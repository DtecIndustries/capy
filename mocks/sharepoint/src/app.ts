import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  graphError,
  resolveShare,
  toDrive,
  toDriveItem,
  toDriveItemVersions,
  toListItem,
  toListItemVersions,
  toSite,
} from './graph.js'
import { LibraryError, type Doc, type Library } from './library.js'

export interface AppConfig {
  library: Library
  // Read access for connectors (Graph-shaped endpoints).
  token: string
  // Write access for the CLI (/admin endpoints).
  adminToken: string
  logger?: boolean
}

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

const personId = { type: 'string', minLength: 1 } as const
const content = { type: 'string', minLength: 1, maxLength: 200_000 } as const

function bearerMatches(header: string | undefined, expected: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  if (!match) return false
  const given = Buffer.from(match[1])
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

export function buildApp(config: AppConfig) {
  const { library } = config
  // Share ids are base64-encoded URLs, longer than Fastify's default 100-char parameter limit.
  const app = Fastify({ logger: config.logger ?? false, bodyLimit: 1024 * 1024, routerOptions: { maxParamLength: 2048 } })

  // Delta tokens carry this epoch: after a restart (live changes are in memory only) old tokens
  // are rejected with 410, and the connector does a full resync, as it would with real Graph.
  const epoch = randomBytes(6).toString('hex')
  const encodeToken = (seq: number) => Buffer.from(`${epoch}.${seq}`).toString('base64url')
  const decodeToken = (token: string): number | undefined => {
    const [tokenEpoch, seq] = Buffer.from(token, 'base64url').toString().split('.')
    const n = Number(seq)
    return tokenEpoch === epoch && Number.isInteger(n) && n >= 0 && n <= library.lastSeq ? n : undefined
  }

  const notFound = (reply: FastifyReply, message = 'The resource could not be found.') =>
    reply.code(404).send(graphError('itemNotFound', message))

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

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof LibraryError) return reply.code(err.status).send(graphError('invalidRequest', err.message))
    if (err.validation) return reply.code(400).send(graphError('invalidRequest', err.message))
    req.log.error(err)
    return reply.code(500).send(graphError('generalException', 'Internal error.'))
  })

  app.get('/health', async () => ({ status: 'ok', documents: library.size, lastSeq: library.lastSeq }))

  type SiteRoute = { Params: { siteId: string } }
  const isSite = (siteId: string) => siteId === library.site.id || siteId === 'root'

  app.get<SiteRoute>('/v1.0/sites/:siteId', async (req, reply) =>
    isSite(req.params.siteId) ? toSite(library) : notFound(reply),
  )

  app.get<SiteRoute>('/v1.0/sites/:siteId/drives', async (req, reply) =>
    isSite(req.params.siteId) ? { value: library.drives.map((d) => toDrive(library, d)) } : notFound(reply),
  )

  type DriveRoute = { Params: { driveId: string } }
  app.get<DriveRoute>('/v1.0/drives/:driveId', async (req, reply) => {
    const drive = library.drives.find((d) => d.id === req.params.driveId)
    return drive ? toDrive(library, drive) : notFound(reply)
  })

  type DeltaRoute = DriveRoute & { Querystring: { token?: string; $skiptoken?: string } }
  app.get<DeltaRoute>('/v1.0/drives/:driveId/root/delta', async (req, reply) => {
    const drive = library.drives.find((d) => d.id === req.params.driveId)
    if (!drive) return notFound(reply)

    let after = 0
    const token = req.query.$skiptoken ?? req.query.token
    if (token !== undefined) {
      const seq = decodeToken(token)
      if (seq === undefined) {
        return reply.code(410).send(graphError('resyncRequired', 'The delta token is invalid or expired. Restart the delta query without a token.'))
      }
      after = seq
    }

    const pageSize = pageSizeFrom(req)
    const changed = library.since(after, drive.id)
    const page = changed.slice(0, pageSize)
    const base = `${req.protocol}://${req.host}${req.url.split('?')[0]}`

    const response: Record<string, unknown> = {
      '@odata.context': `${req.protocol}://${req.host}/v1.0/$metadata#Collection(driveItem)`,
      value: page.map((doc) => toDriveItem(library, doc)),
    }
    if (changed.length > page.length) {
      response['@odata.nextLink'] = `${base}?$skiptoken=${encodeToken(page[page.length - 1].changeSeq)}`
    } else {
      response['@odata.deltaLink'] = `${base}?token=${encodeToken(library.lastSeq)}`
    }
    reply.header('Preference-Applied', `odata.maxpagesize=${pageSize}`)
    return response
  })

  type ItemRoute = { Params: { driveId: string; itemId: string }; Querystring: { $expand?: string } }
  const itemIn = (params: ItemRoute['Params']): Doc | undefined => {
    const doc = library.get(params.itemId)
    return doc && doc.drive === params.driveId ? doc : undefined
  }

  app.get<ItemRoute>('/v1.0/drives/:driveId/items/:itemId', async (req, reply) => {
    const doc = itemIn(req.params)
    if (!doc) return notFound(reply)
    const item = toDriveItem(library, doc)
    return req.query.$expand === 'listItem' ? { ...item, listItem: toListItem(library, doc) } : item
  })

  // Real Graph answers /content with a 302 to a download URL; serving the bytes directly is
  // what a client ends up with after following that redirect.
  app.get<ItemRoute>('/v1.0/drives/:driveId/items/:itemId/content', async (req, reply) => {
    const doc = itemIn(req.params)
    if (!doc) return notFound(reply)
    return reply.type('text/markdown; charset=utf-8').send(doc.versions[doc.versions.length - 1].content)
  })

  app.get<ItemRoute>('/v1.0/drives/:driveId/items/:itemId/versions', async (req, reply) => {
    const doc = itemIn(req.params)
    return doc ? { value: toDriveItemVersions(library, doc) } : notFound(reply)
  })

  type VersionRoute = { Params: ItemRoute['Params'] & { versionId: string } }
  app.get<VersionRoute>('/v1.0/drives/:driveId/items/:itemId/versions/:versionId/content', async (req, reply) => {
    const version = itemIn(req.params)?.versions.find((v) => v.version === req.params.versionId)
    if (!version) return notFound(reply)
    return reply.type('text/markdown; charset=utf-8').send(version.content)
  })

  app.get<ItemRoute>('/v1.0/drives/:driveId/items/:itemId/listItem', async (req, reply) => {
    const doc = itemIn(req.params)
    return doc ? toListItem(library, doc) : notFound(reply)
  })

  app.get<ItemRoute>('/v1.0/drives/:driveId/items/:itemId/listItem/versions', async (req, reply) => {
    const doc = itemIn(req.params)
    return doc ? { value: toListItemVersions(library, doc) } : notFound(reply)
  })

  // Resolves sharing links (such as the SharePoint links in mails) to the drive item.
  app.get<{ Params: { shareId: string } }>('/v1.0/shares/:shareId/driveItem', async (req, reply) => {
    const doc = resolveShare(library, req.params.shareId)
    return doc ? toDriveItem(library, doc) : notFound(reply)
  })

  const summary = (doc: Doc) => {
    const latest = doc.versions[doc.versions.length - 1]
    return {
      id: doc.id,
      drive: doc.drive,
      path: doc.path,
      version: latest.version,
      approval: latest.approval,
      owner: doc.owner,
      sha256: latest.sha256,
      changeSeq: doc.changeSeq,
    }
  }

  type UploadBody = {
    as: string
    drive: string
    path: string
    title: string
    content: string
    document_type?: string
    owner?: string
    country?: string
  }
  app.post<{ Body: UploadBody }>(
    '/admin/documents',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['as', 'drive', 'path', 'title', 'content'],
          properties: {
            as: personId,
            drive: { type: 'string', minLength: 1 },
            path: { type: 'string', minLength: 4, maxLength: 400 },
            title: { type: 'string', minLength: 1, maxLength: 255 },
            content,
            document_type: { type: 'string', minLength: 1, maxLength: 100 },
            owner: personId,
            country: { type: 'string', pattern: '^[A-Z]{2}$' },
          },
        },
      },
    },
    async (req, reply) => reply.code(201).send(summary(library.upload(req.body))),
  )

  type AdminDocRoute = { Params: { id: string } }
  app.post<AdminDocRoute & { Body: { as: string; content: string; minor?: boolean } }>(
    '/admin/documents/:id/versions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['as', 'content'],
          properties: { as: personId, content, minor: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => reply.code(201).send(summary(library.addVersion(req.params.id, req.body))),
  )

  app.post<AdminDocRoute & { Body: { as: string; status: 'approved' | 'rejected' } }>(
    '/admin/documents/:id/approval',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['as', 'status'],
          properties: { as: personId, status: { enum: ['approved', 'rejected'] } },
        },
      },
    },
    async (req) => summary(library.approve(req.params.id, req.body)),
  )

  app.put<AdminDocRoute & { Body: { as: string; owner: string } }>(
    '/admin/documents/:id/owner',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['as', 'owner'],
          properties: { as: personId, owner: personId },
        },
      },
    },
    async (req) => summary(library.setOwner(req.params.id, req.body)),
  )

  return app
}

// Graph clients ask for a page size with "Prefer: odata.maxpagesize=N".
function pageSizeFrom(req: FastifyRequest): number {
  const match = /odata\.maxpagesize=(\d+)/.exec(String(req.headers.prefer ?? ''))
  const size = match ? Number(match[1]) : DEFAULT_PAGE_SIZE
  return Math.min(Math.max(size, 1), MAX_PAGE_SIZE)
}
