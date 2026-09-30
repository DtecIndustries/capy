import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app.js'
import { loadDirectory, loadMailbox } from '../src/mailbox.js'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const TOKEN = 'test-token'
const ADMIN = 'test-admin-token'

function setup() {
  const mailbox = loadMailbox(path('../mailbox.jsonl'), loadDirectory(path('../../seed/directory.json')))
  const app = buildApp({ mailbox, token: TOKEN, adminToken: ADMIN, sharepointBaseUrl: 'https://sp.example.test/sites/k' })
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${TOKEN}`, ...headers } })
  return { app, mailbox, get }
}

// Follows nextLink pages until a deltaLink, like a Graph connector does.
async function drain(get: ReturnType<typeof setup>['get'], url: string, pageSize?: number) {
  const headers = pageSize ? { prefer: `odata.maxpagesize=${pageSize}` } : undefined
  const messages: { id: string }[] = []
  let pages = 0
  for (;;) {
    const res = await get(url, headers)
    assert.equal(res.statusCode, 200, res.body)
    const body = res.json()
    messages.push(...body.value)
    pages++
    if (body['@odata.deltaLink']) return { messages, pages, deltaLink: new URL(body['@odata.deltaLink']) }
    url = new URL(body['@odata.nextLink']).pathname + new URL(body['@odata.nextLink']).search
  }
}

test('seed mailbox loads and validates', () => {
  const { mailbox } = setup()
  assert.equal(mailbox.lastSeq, 30)
})

test('rejects missing or wrong tokens, and the read token on admin routes', async () => {
  const { app } = setup()
  assert.equal((await app.inject({ url: '/v1.0/users' })).statusCode, 401)
  assert.equal((await app.inject({ url: '/v1.0/users', headers: { authorization: 'Bearer nope' } })).statusCode, 401)
  const admin = await app.inject({
    method: 'POST',
    url: '/admin/messages',
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: { from: 'anna.claes', to: ['sophie.dubois'], subject: 'x', body: 'x' },
  })
  assert.equal(admin.statusCode, 401)
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200)
})

test('sent items across all users contain every mail exactly once', async () => {
  const { mailbox, get } = setup()
  const ids: string[] = []
  for (const person of mailbox.directory.people) {
    const { messages } = await drain(get, `/v1.0/users/${person.id}/mailFolders/sentitems/messages/delta`)
    ids.push(...messages.map((m) => m.id))
  }
  assert.equal(ids.length, 30)
  assert.equal(new Set(ids).size, 30)
})

test('delta pages with nextLink and then returns only new mails', async () => {
  const { app, get } = setup()
  const first = await drain(get, '/v1.0/users/anna.claes/mailFolders/inbox/messages/delta', 2)
  assert.ok(first.pages > 1)

  const empty = await drain(get, first.deltaLink.pathname + first.deltaLink.search)
  assert.equal(empty.messages.length, 0)

  const sent = await app.inject({
    method: 'POST',
    url: '/admin/messages',
    headers: { authorization: `Bearer ${ADMIN}` },
    payload: { from: 'sophie.dubois', to: ['anna.claes'], is_reply_to: 'mail-014', body: 'Terug van verlof!', references: ['doc-041'] },
  })
  assert.equal(sent.statusCode, 201, sent.body)
  const { record } = sent.json()
  assert.equal(record.id, 'mail-031')
  assert.equal(record.thread_id, 'thr-13')

  const next = await drain(get, first.deltaLink.pathname + first.deltaLink.search)
  assert.deepEqual(next.messages.map((m) => m.id), ['mail-031'])
})

test('reply carries In-Reply-To and References headers; doc refs are reference attachments', async () => {
  const { get } = setup()
  const res = await get('/v1.0/users/sophie.dubois/messages/mail-006?$expand=attachments')
  const msg = res.json()
  const header = (name: string) => msg.internetMessageHeaders.find((h: { name: string }) => h.name === name)?.value
  assert.equal(header('In-Reply-To'), '<mail-005@mail.capy.example.test>')
  assert.equal(header('References'), '<mail-004@mail.capy.example.test> <mail-005@mail.capy.example.test>')
  const refs = msg.attachments.filter((a: { '@odata.type': string }) => a['@odata.type'] === '#microsoft.graph.referenceAttachment')
  assert.deepEqual(
    refs.map((a: { sourceUrl: string }) => a.sourceUrl),
    [
      'https://sp.example.test/sites/k/_layouts/15/Doc.aspx?sourcedoc=doc-014&version=2.0',
      'https://sp.example.test/sites/k/_layouts/15/Doc.aspx?sourcedoc=doc-021',
    ],
  )
})

test('users cannot read mails they are not part of', async () => {
  const { get } = setup()
  assert.equal((await get('/v1.0/users/marc.dupont/messages/mail-006')).statusCode, 404)
})

test('bcc is only visible in the sender copy', async () => {
  const { app, get } = setup()
  await app.inject({
    method: 'POST',
    url: '/admin/messages',
    headers: { authorization: `Bearer ${ADMIN}` },
    payload: { from: 'jan.peeters', to: ['tom.maes'], bcc: ['katrien.janssens'], subject: 'Heads-up', body: 'x' },
  })
  const asSender = (await get('/v1.0/users/jan.peeters/messages/mail-031')).json()
  const asBcc = (await get('/v1.0/users/katrien.janssens/messages/mail-031')).json()
  assert.equal(asSender.bccRecipients.length, 1)
  assert.equal(asBcc.bccRecipients.length, 0)
})

test('rejects mails from people who left, and unknown recipients', async () => {
  const { app } = setup()
  const send = (payload: object) =>
    app.inject({ method: 'POST', url: '/admin/messages', headers: { authorization: `Bearer ${ADMIN}` }, payload })
  assert.equal((await send({ from: 'pieter.devos', to: ['tom.maes'], subject: 'x', body: 'x' })).statusCode, 400)
  assert.equal((await send({ from: 'tom.maes', to: ['nobody'], subject: 'x', body: 'x' })).statusCode, 400)
})

test('unknown or foreign delta tokens require a resync (410)', async () => {
  const { get } = setup()
  const res = await get('/v1.0/users/anna.claes/mailFolders/inbox/messages/delta?$deltatoken=Zm9vLjM')
  assert.equal(res.statusCode, 410)
})
