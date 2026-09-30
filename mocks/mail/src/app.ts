import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  graphError,
  isInFolder,
  parseFolder,
  toGraphAttachments,
  toGraphMessage,
  toGraphUser,
  type FolderId,
} from './graph.js'
import { MailValidationError, type Mailbox, type MailRecord } from './mailbox.js'

export interface AppConfig {
  mailbox: Mailbox
  // Read access for connectors (Graph-shaped endpoints).
  token: string
  // Write access for the send-mail command (/admin endpoints).
  adminToken: string
  sharepointBaseUrl: string
  logger?: boolean
}

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

const DISCLAIMERS: Record<string, string> = {
  en: 'This message is confidential and intended only for the addressee. If you received it in error, please notify the sender and delete it.',
  nl: 'Dit bericht is vertrouwelijk en uitsluitend bestemd voor de geadresseerde. Heeft u het per vergissing ontvangen, verwijder het dan en laat het de afzender weten.',
  fr: "Ce message est confidentiel et destiné uniquement à son destinataire. Si vous l'avez reçu par erreur, merci de le supprimer et d'en informer l'expéditeur.",
}

interface SendMailBody {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  body: string
  is_reply_to?: string
  references?: string[]
  importance?: 'low' | 'normal' | 'high'
  language?: string
  attachments?: { name: string; size_kb: number }[]
  sent_at?: string
}

const personIds = { type: 'array', items: { type: 'string', minLength: 1 } } as const

const sendMailSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to', 'body'],
  properties: {
    from: { type: 'string', minLength: 1 },
    to: { ...personIds, minItems: 1 },
    cc: personIds,
    bcc: personIds,
    subject: { type: 'string', minLength: 1, maxLength: 255 },
    body: { type: 'string', minLength: 1, maxLength: 20000 },
    is_reply_to: { type: 'string', minLength: 1 },
    references: { type: 'array', items: { type: 'string', pattern: '^doc-[a-z0-9-]+(@[0-9.]+)?$' } },
    importance: { enum: ['low', 'normal', 'high'] },
    language: { type: 'string', minLength: 2, maxLength: 5 },
    attachments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'size_kb'],
        properties: { name: { type: 'string', minLength: 1 }, size_kb: { type: 'number', minimum: 0 } },
      },
    },
    sent_at: { type: 'string', format: 'date-time' },
  },
} as const

function bearerMatches(header: string | undefined, expected: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  if (!match) return false
  const given = Buffer.from(match[1])
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

export function buildApp(config: AppConfig) {
  const { mailbox } = config
  const app = Fastify({ logger: config.logger ?? false })

  // Delta tokens carry this epoch: after a restart (live mails are in memory only) old tokens
  // are rejected with 410, and the connector does a full resync, as it would with real Graph.
  const epoch = randomBytes(6).toString('hex')
  const encodeToken = (seq: number) => Buffer.from(`${epoch}.${seq}`).toString('base64url')
  const decodeToken = (token: string): number | undefined => {
    const [tokenEpoch, seq] = Buffer.from(token, 'base64url').toString().split('.')
    const n = Number(seq)
    return tokenEpoch === epoch && Number.isInteger(n) && n >= 0 && n <= mailbox.lastSeq ? n : undefined
  }

  const notFound = (reply: FastifyReply, code: string, message: string) =>
    reply.code(404).send(graphError(code, message))

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]
    if (path === '/health') return
    const expected = path.startsWith('/admin/') ? config.adminToken : config.token
    if (!bearerMatches(req.headers.authorization, expected)) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer')
        .send(graphError('InvalidAuthenticationToken', 'Access token is missing or invalid.'))
    }
  })

  app.get('/health', async () => ({ status: 'ok', messages: mailbox.lastSeq }))

  app.get('/v1.0/users', async () => ({
    value: mailbox.directory.people.map((p) =>
      toGraphUser(p, mailbox.directory.teams.find((t) => t.id === p.team)?.name),
    ),
  }))

  type UserParams = { Params: { userId: string } }
  app.get<UserParams>('/v1.0/users/:userId', async (req, reply) => {
    const person = mailbox.findPerson(req.params.userId)
    if (!person) return notFound(reply, 'Request_ResourceNotFound', `User '${req.params.userId}' does not exist.`)
    return toGraphUser(person, mailbox.directory.teams.find((t) => t.id === person.team)?.name)
  })

  type DeltaRoute = {
    Params: { userId: string; folderId: string }
    Querystring: { $deltatoken?: string; $skiptoken?: string }
  }
  app.get<DeltaRoute>('/v1.0/users/:userId/mailFolders/:folderId/messages/delta', async (req, reply) => {
    const person = mailbox.findPerson(req.params.userId)
    if (!person) return notFound(reply, 'ErrorInvalidUser', `The requested user '${req.params.userId}' is invalid.`)
    const folder = parseFolder(req.params.folderId)
    if (!folder) {
      return notFound(reply, 'ErrorFolderNotFound', 'Only the well-known folders inbox and sentitems are mocked.')
    }

    let after = 0
    const token = req.query.$skiptoken ?? req.query.$deltatoken
    if (token !== undefined) {
      const seq = decodeToken(token)
      if (seq === undefined) {
        return reply.code(410).send(graphError('SyncStateNotFound', 'The sync state is invalid or expired. Restart the delta query without a token.'))
      }
      after = seq
    }

    const pageSize = pageSizeFrom(req)
    const matches = mailbox.since(after).filter((e) => isInFolder(e.mail, person.id, folder))
    const page = matches.slice(0, pageSize)
    const base = `${req.protocol}://${req.host}${req.url.split('?')[0]}`

    const response: Record<string, unknown> = {
      '@odata.context': `${req.protocol}://${req.host}/v1.0/$metadata#Collection(message)`,
      value: page.map((e) => toGraphMessage(mailbox, e.mail, folder)),
    }
    if (matches.length > page.length) {
      response['@odata.nextLink'] = `${base}?$skiptoken=${encodeToken(page[page.length - 1].seq)}`
    } else {
      response['@odata.deltaLink'] = `${base}?$deltatoken=${encodeToken(mailbox.lastSeq)}`
    }
    reply.header('Preference-Applied', `odata.maxpagesize=${pageSize}`)
    return response
  })

  // A user can only read mails they sent or received, like their own Exchange mailbox.
  const mailFor = (userId: string, messageId: string): { mail: MailRecord; folder: FolderId } | undefined => {
    const person = mailbox.findPerson(userId)
    const mail = mailbox.get(messageId)
    if (!person || !mail) return undefined
    if (isInFolder(mail, person.id, 'sentitems')) return { mail, folder: 'sentitems' }
    if (isInFolder(mail, person.id, 'inbox')) return { mail, folder: 'inbox' }
    return undefined
  }

  type MessageRoute = { Params: { userId: string; messageId: string }; Querystring: { $expand?: string } }
  app.get<MessageRoute>('/v1.0/users/:userId/messages/:messageId', async (req, reply) => {
    const found = mailFor(req.params.userId, req.params.messageId)
    if (!found) return notFound(reply, 'ErrorItemNotFound', 'The specified object was not found in the store.')
    const message = toGraphMessage(mailbox, found.mail, found.folder)
    return req.query.$expand === 'attachments'
      ? { ...message, attachments: toGraphAttachments(found.mail, config.sharepointBaseUrl) }
      : message
  })

  app.get<MessageRoute>('/v1.0/users/:userId/messages/:messageId/attachments', async (req, reply) => {
    const found = mailFor(req.params.userId, req.params.messageId)
    if (!found) return notFound(reply, 'ErrorItemNotFound', 'The specified object was not found in the store.')
    return { value: toGraphAttachments(found.mail, config.sharepointBaseUrl) }
  })

  app.post<{ Body: SendMailBody }>('/admin/messages', { schema: { body: sendMailSchema } }, async (req, reply) => {
    const input = req.body
    const parent = input.is_reply_to ? mailbox.get(input.is_reply_to) : undefined
    if (input.is_reply_to && !parent) {
      return reply.code(400).send(graphError('ErrorInvalidRequest', `Unknown mail '${input.is_reply_to}' in is_reply_to.`))
    }
    const subject = input.subject ?? (parent ? `Re: ${parent.subject.replace(/^re:\s*/i, '')}` : undefined)
    if (!subject) return reply.code(400).send(graphError('ErrorInvalidRequest', 'subject is required for a new thread.'))

    const sender = mailbox.person(input.from)
    const team = mailbox.directory.teams.find((t) => t.id === sender?.team)
    const language = input.language ?? 'en'
    const mail: MailRecord = {
      id: mailbox.nextMailId(),
      thread_id: parent?.thread_id ?? mailbox.nextThreadId(),
      from: input.from,
      to: input.to,
      sent_at: input.sent_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      subject,
      references: input.references ?? [],
      is_reply_to: parent?.id ?? null,
      body: input.body,
      filler: {
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        importance: input.importance ?? 'normal',
        attachments: input.attachments ?? [],
        signature: sender ? [sender.name, sender.role, team?.name].filter(Boolean).join(' · ') : '',
        disclaimer: DISCLAIMERS[language] ?? DISCLAIMERS.en,
        quoted_history: parent ? `${parent.subject}\n\n${parent.body}` : '',
        language,
      },
    }

    try {
      const entry = mailbox.add(mail)
      req.log.info({ id: mail.id, thread_id: mail.thread_id, seq: entry.seq }, 'live mail added')
      return reply.code(201).send({ seq: entry.seq, record: mail, message: toGraphMessage(mailbox, mail, 'sentitems') })
    } catch (err) {
      if (err instanceof MailValidationError) {
        return reply.code(400).send(graphError('ErrorInvalidRequest', err.message))
      }
      throw err
    }
  })

  return app
}

// Graph clients ask for a page size with "Prefer: odata.maxpagesize=N".
function pageSizeFrom(req: FastifyRequest): number {
  const match = /odata\.maxpagesize=(\d+)/.exec(String(req.headers.prefer ?? ''))
  const size = match ? Number(match[1]) : DEFAULT_PAGE_SIZE
  return Math.min(Math.max(size, 1), MAX_PAGE_SIZE)
}
