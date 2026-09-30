import { readFileSync } from 'node:fs'

// Shapes follow docs/ARCHITECTURE.md ("Org directory" and "Mock mail").

export interface Person {
  id: string
  name: string
  team: string
  role: string
  status: 'active' | 'left'
  left_at: string | null
  client_bindings: string[]
  email: string
}

export interface Directory {
  teams: { id: string; name: string; app: string }[]
  clients: { id: string; name: string; country: string }[]
  people: Person[]
}

export interface MailRecord {
  id: string
  thread_id: string
  from: string
  to: string[]
  sent_at: string
  subject: string
  references: string[]
  is_reply_to: string | null
  // Out-of-office and similar automatic replies.
  auto_reply?: boolean
  body: string
  filler: {
    cc: string[]
    bcc: string[]
    importance: 'low' | 'normal' | 'high'
    attachments: { name: string; size_kb: number }[]
    signature: string
    disclaimer: string
    quoted_history: string
    language: string
  }
}

export interface MailEntry {
  seq: number
  mail: MailRecord
}

export class MailValidationError extends Error {}

export function loadDirectory(path: string): Directory {
  return JSON.parse(readFileSync(path, 'utf8')) as Directory
}

export class Mailbox {
  private readonly entries: MailEntry[] = []
  private readonly byId = new Map<string, MailRecord>()
  private readonly people: Map<string, Person>

  constructor(readonly directory: Directory) {
    this.people = new Map(directory.people.map((p) => [p.id, p]))
  }

  get lastSeq(): number {
    return this.entries.length
  }

  add(mail: MailRecord): MailEntry {
    this.validate(mail)
    const entry = { seq: this.entries.length + 1, mail }
    this.entries.push(entry)
    this.byId.set(mail.id, mail)
    return entry
  }

  get(id: string): MailRecord | undefined {
    return this.byId.get(id)
  }

  since(seq: number): MailEntry[] {
    return this.entries.slice(seq)
  }

  person(id: string): Person | undefined {
    return this.people.get(id)
  }

  // Graph accepts either the object id or the UPN (mail address) in /users/{id}.
  findPerson(idOrEmail: string): Person | undefined {
    const key = idOrEmail.toLowerCase()
    return this.people.get(key) ?? this.directory.people.find((p) => p.email.toLowerCase() === key)
  }

  // Oldest first, so it can be used directly as the RFC 5322 References header.
  ancestors(mail: MailRecord): MailRecord[] {
    const chain: MailRecord[] = []
    let parentId = mail.is_reply_to
    while (parentId) {
      const parent = this.byId.get(parentId)
      if (!parent) break
      chain.unshift(parent)
      parentId = parent.is_reply_to
    }
    return chain
  }

  nextMailId(): string {
    return `mail-${String(this.maxNumber('mail-', [...this.byId.keys()]) + 1).padStart(3, '0')}`
  }

  nextThreadId(): string {
    const threads = [...this.byId.values()].map((m) => m.thread_id)
    return `thr-${String(this.maxNumber('thr-', threads) + 1).padStart(2, '0')}`
  }

  private maxNumber(prefix: string, ids: string[]): number {
    return ids.reduce((max, id) => {
      const n = Number(id.slice(prefix.length))
      return id.startsWith(prefix) && Number.isInteger(n) ? Math.max(max, n) : max
    }, 0)
  }

  private validate(mail: MailRecord): void {
    const fail = (msg: string): never => {
      throw new MailValidationError(`${mail.id ?? '<no id>'}: ${msg}`)
    }
    if (!mail.id || this.byId.has(mail.id)) fail('missing or duplicate id')
    if (!mail.thread_id) fail('missing thread_id')
    if (Number.isNaN(Date.parse(mail.sent_at))) fail(`invalid sent_at '${mail.sent_at}'`)
    if (mail.to.length === 0) fail('no recipients')

    const sender = this.people.get(mail.from) ?? fail(`unknown sender '${mail.from}'`)
    if (sender.left_at && Date.parse(mail.sent_at) > Date.parse(sender.left_at)) {
      fail(`sender '${sender.id}' left on ${sender.left_at}`)
    }
    for (const id of [...mail.to, ...mail.filler.cc, ...mail.filler.bcc]) {
      if (!this.people.has(id)) fail(`unknown recipient '${id}'`)
    }

    if (mail.is_reply_to) {
      const parent = this.byId.get(mail.is_reply_to) ?? fail(`replies to unknown mail '${mail.is_reply_to}'`)
      if (parent.thread_id !== mail.thread_id) fail(`thread_id differs from parent (${parent.thread_id})`)
      if (Date.parse(mail.sent_at) < Date.parse(parent.sent_at)) fail('sent before the mail it replies to')
    }
  }
}

export function loadMailbox(path: string, directory: Directory): Mailbox {
  const mailbox = new Mailbox(directory)
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (!line.trim()) return
      try {
        mailbox.add(JSON.parse(line) as MailRecord)
      } catch (err) {
        throw new Error(`${path}:${i + 1}: ${(err as Error).message}`)
      }
    })
  return mailbox
}
