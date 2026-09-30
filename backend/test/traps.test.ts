// One test per planted trap, end to end: the two mock services and an in-process Postgres
// (PGlite) are started, everything is ingested through the real connectors, and the verdicts
// are checked. Then the live demo moments are replayed and the verdicts must change.
// Needs `pnpm install` in mocks/mail and mocks/sharepoint as well.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))
const PG_PORT = 5439
const READ = 'test-read'
const ADMIN = 'test-admin'

const pg = new PGLiteSocketServer({ db: await PGlite.create(), port: PG_PORT, host: '127.0.0.1' })
await pg.start()
process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${PG_PORT}/postgres`
process.env.DATABASE_POOL_MAX = '1'
process.env.SEED_DIR = repo('mocks/seed')

// Imported after DATABASE_URL is set: the db client connects on import.
const { sql } = await import('../src/db/client.js')
const { migrate } = await import('../src/db/migrate.js')
const { record } = await import('../src/ingestion/record.js')
const { loadSeed } = await import('../src/ingestion/seed.js')
const { ingestOnce } = await import('../src/ingestion/worker.js')
const { GraphClient } = await import('../src/ingestion/graph.js')
const { lookup } = await import('../src/engines/lookup.js')
const { getHealth } = await import('../src/engines/health.js')
const { verifyChain } = await import('../src/ledger/verify.js')
const { canSeeDocument } = await import('../src/access/scope.js')

const mailMock = await import('../../mocks/mail/src/app.js')
const mailData = await import('../../mocks/mail/src/mailbox.js')
const spMock = await import('../../mocks/sharepoint/src/app.js')
const spData = await import('../../mocks/sharepoint/src/library.js')

const directory = mailData.loadDirectory(repo('mocks/seed/directory.json'))
const mailApp = mailMock.buildApp({
  mailbox: mailData.loadMailbox(repo('mocks/mail/mailbox.jsonl'), directory),
  token: READ,
  adminToken: ADMIN,
  sharepointBaseUrl: 'https://capydemo.sharepoint.example.test/sites/knowledge',
})
const spApp = spMock.buildApp({
  library: spData.loadLibrary(repo('mocks/sharepoint/sharepoint.meta.json'), directory as never),
  token: READ,
  adminToken: ADMIN,
})

let sharepoint: InstanceType<typeof GraphClient>
let mail: InstanceType<typeof GraphClient>

const ingest = () => ingestOnce(sharepoint, mail)
const verdicts = (docs: { document_version_id: string; verdict: string }[]) =>
  Object.fromEntries(docs.map((d) => [d.document_version_id, d.verdict]))
const all = async (app: string, domain: string, client: string) => {
  const r = await lookup({ app, domain, client })
  return { ...r, verdicts: verdicts([...r.trusted, ...r.excluded]) }
}
async function admin(app: typeof mailApp | typeof spApp, method: 'POST' | 'PUT', url: string, payload: object) {
  const res = await app.inject({ method, url, headers: { authorization: `Bearer ${ADMIN}` }, payload })
  assert.ok(res.statusCode < 300, res.body)
}

before(async () => {
  await mailApp.listen({ port: 0, host: '127.0.0.1' })
  await spApp.listen({ port: 0, host: '127.0.0.1' })
  sharepoint = new GraphClient(`http://127.0.0.1:${(spApp.server.address() as AddressInfo).port}/v1.0`, READ)
  mail = new GraphClient(`http://127.0.0.1:${(mailApp.server.address() as AddressInfo).port}/v1.0`, READ)
  await migrate()
  await record(await loadSeed())
  await ingest()
})

after(async () => {
  await sql.end()
  await mailApp.close()
  await spApp.close()
  await pg.stop()
})

describe('planted traps', () => {
  test('superseded version: doc-014 v1.0 is stale', async () => {
    const { verdicts } = await all('pay', 'pay.sick-leave', 'client-x')
    assert.equal(verdicts['doc-014@1.0'], 'stale')
  })

  test('duplicate: the copy doc-015 is recognised as a copy of superseded doc-014 v1.0', async () => {
    const { excluded } = await all('pay', 'pay.sick-leave', 'client-x')
    const copy = excluded.find((d) => d.document_id === 'doc-015')!
    assert.equal(copy.verdict, 'stale')
    assert.equal(copy.signals.copy_of, 'doc-014@1.0')
  })

  test('wrong country: the NL procedure doc-030 does not apply to a BE client', async () => {
    const { verdicts } = await all('pay', 'pay.sick-leave', 'client-x')
    assert.equal(verdicts['doc-030@1.0'], 'scope_mismatch')
  })

  test('contradiction: Time note doc-071 disagrees with doc-014 v2.0 and doc-021, nothing is trusted, route to Pay', async () => {
    const r = await all('pay', 'pay.sick-leave', 'client-x')
    assert.equal(r.verdicts['doc-071@1.0'], 'conflict')
    assert.equal(r.verdicts['doc-014@2.0'], 'conflict')
    assert.equal(r.verdicts['doc-021@1.0'], 'conflict')
    assert.equal(r.route_to?.team.id, 'team-pay')
    const conflict = r.excluded.find((d) => d.document_version_id === 'doc-071@1.0')!.conflicts[0]
    assert.equal(conflict.question, 'Is the first day of sickness paid?')
  })

  test('ownerless: Polderveld note doc-050 belongs to someone who left, and they are no expert anymore', async () => {
    const r = await all('pay', 'pay.gross-to-net', 'client-y')
    assert.equal(r.verdicts['doc-050@2.0'], 'unowned')
    assert.ok(!r.experts.some((e) => e.person_id === 'pieter.devos'))
  })

  test('never reviewed: the Ardenne addendum doc-041 is unverified, not trusted', async () => {
    const { verdicts } = await all('pay', 'pay.year-end', 'client-z')
    assert.equal(verdicts['doc-041@1.0'], 'unverified')
    assert.equal(verdicts['doc-040@1.0'], 'trusted')
  })

  test('single expert: only Sophie knows Ardenne year-end', async () => {
    const r = await all('pay', 'pay.year-end', 'client-z')
    assert.equal(r.bus_factor_risk, true)
    assert.equal(r.experts[0].person_id, 'sophie.dubois')
  })

  test('clean context: Scheldemond year-end is trusted and client-specific first', async () => {
    const r = await all('pay', 'pay.year-end', 'client-x')
    assert.equal(r.trusted[0].document_version_id, 'doc-042@1.0')
    assert.equal(r.trusted[0].verdict, 'trusted')
    assert.equal(r.route_to, null)
  })

  test('health: superseded version still circulating, outdated checklist, duplicate', async () => {
    const pay = await getHealth('pay', 'pay.sick-leave')
    assert.ok(pay.findings.some((f) => f.kind === 'stale' && f.description.includes('mail-005')))
    assert.ok(pay.findings.some((f) => f.kind === 'duplicate' && f.subject_id === 'doc-015'))
    assert.ok(pay.findings.some((f) => f.kind === 'conflict'))
    const hr = await getHealth('hr', 'hr.onboarding')
    assert.ok(hr.findings.some((f) => f.kind === 'stale' && f.subject_id === 'doc-060'))
  })

  test('access: a caller only sees documents of their own clients', async () => {
    const anna = { person_id: 'anna.claes', name: 'Anna Claes', team_id: 'team-pay', client_ids: ['client-x', 'client-z'] }
    assert.equal(await canSeeDocument(anna, 'doc-021'), true)
    assert.equal(await canSeeDocument(anna, 'doc-050'), false)
    assert.equal(await canSeeDocument(anna, 'doc-040'), true)
  })

  test('ledger: the hash chain verifies', async () => {
    assert.deepEqual(await verifyChain(), { valid: true })
  })
})

describe('live demo moments', () => {
  test('Lucas fixes the Time note: the contradiction is gone and the Pay procedure is trusted again', async () => {
    await admin(spApp, 'POST', '/admin/documents/doc-071/versions', {
      as: 'lucas.jacobs',
      content: readFileSync(repo('mocks/sharepoint/live/doc-071-v2.md'), 'utf8'),
    })
    await ingest()
    const r = await all('pay', 'pay.sick-leave', 'client-x')
    assert.equal(r.verdicts['doc-014@2.0'], 'trusted')
    assert.equal(r.verdicts['doc-021@1.0'], 'trusted')
    assert.equal(r.route_to, null)
  })

  test('Katrien reviews the Ardenne addendum and answers: trusted, and no longer a single expert', async () => {
    await admin(spApp, 'POST', '/admin/documents/doc-041/approval', { as: 'katrien.janssens', status: 'approved' })
    await admin(mailApp, 'POST', '/admin/messages', JSON.parse(readFileSync(repo('mocks/mail/live/02-second-expert-client-z-year-end.json'), 'utf8')))
    await ingest()
    const r = await all('pay', 'pay.year-end', 'client-z')
    assert.equal(r.verdicts['doc-041@1.0'], 'trusted')
    assert.equal(r.bus_factor_risk, false)
  })

  test('Lotte adopts the Polderveld note: it has an active owner again and she shows up as expert', async () => {
    await admin(spApp, 'POST', '/admin/documents/doc-050/versions', {
      as: 'lotte.vermeulen',
      content: readFileSync(repo('mocks/sharepoint/live/doc-050-v3.md'), 'utf8'),
    })
    await admin(spApp, 'PUT', '/admin/documents/doc-050/owner', { as: 'katrien.janssens', owner: 'lotte.vermeulen' })
    await ingest()
    const r = await all('pay', 'pay.gross-to-net', 'client-y')
    assert.equal(r.verdicts['doc-050@3.0'], 'unverified')
    assert.equal(r.verdicts['doc-050@2.0'], 'stale')
    assert.equal(r.experts[0].person_id, 'lotte.vermeulen')
  })

  test('ledger: still valid after the live changes', async () => {
    assert.deepEqual(await verifyChain(), { valid: true })
  })
})
