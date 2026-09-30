import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app.js'
import { loadLibrary, type Directory } from '../src/library.js'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const TOKEN = 'test-token'
const ADMIN = 'test-admin-token'

function setup() {
  const directory = JSON.parse(readFileSync(path('../../seed/directory.json'), 'utf8')) as Directory
  const library = loadLibrary(path('../sharepoint.meta.json'), directory)
  const app = buildApp({ library, token: TOKEN, adminToken: ADMIN })
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${TOKEN}`, ...headers } })
  const admin = (method: 'POST' | 'PUT', url: string, payload: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${ADMIN}` }, payload })
  return { app, library, get, admin }
}

// Follows nextLink pages until a deltaLink, like a Graph connector does.
async function drain(get: ReturnType<typeof setup>['get'], url: string, pageSize?: number) {
  const headers = pageSize ? { prefer: `odata.maxpagesize=${pageSize}` } : undefined
  const items: { id: string; [key: string]: unknown }[] = []
  for (;;) {
    const res = await get(url, headers)
    assert.equal(res.statusCode, 200, res.body)
    const body = res.json()
    items.push(...body.value)
    const next = body['@odata.nextLink'] ?? body['@odata.deltaLink']
    const nextUrl = new URL(next)
    if (body['@odata.deltaLink']) return { items, deltaLink: nextUrl.pathname + nextUrl.search }
    url = nextUrl.pathname + nextUrl.search
  }
}

test('library loads 13 documents across three drives', async () => {
  const { library, get } = setup()
  assert.equal(library.size, 13)
  const drives = (await get('/v1.0/sites/root/drives')).json().value.map((d: { id: string }) => d.id)
  assert.deepEqual(drives, ['drive-pay', 'drive-time', 'drive-hr'])
})

test('requires the read token; the admin token is separate', async () => {
  const { app, get } = setup()
  assert.equal((await get('/v1.0/sites/root', { authorization: 'Bearer nope' })).statusCode, 401)
  assert.equal((await get('/v1.0/sites/root', { authorization: `Bearer ${ADMIN}` })).statusCode, 401)
  assert.equal((await get('/v1.0/sites/root')).statusCode, 200)
  const withReadToken = await app.inject({
    method: 'POST',
    url: '/admin/documents/doc-041/approval',
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: { as: 'katrien.janssens', status: 'approved' },
  })
  assert.equal(withReadToken.statusCode, 401)
})

test('trap: doc-014 v1.0 is superseded by an approved v2.0 and served from history', async () => {
  const { get } = setup()
  const versions = (await get('/v1.0/drives/drive-pay/items/doc-014/listItem/versions')).json().value
  assert.deepEqual(
    versions.map((v: { id: string; fields: { ApprovalStatus: string } }) => [v.id, v.fields.ApprovalStatus]),
    [['2.0', 'Approved'], ['1.0', 'Approved']],
  )
  const v1 = (await get('/v1.0/drives/drive-pay/items/doc-014/versions/1.0/content')).body
  const v2 = (await get('/v1.0/drives/drive-pay/items/doc-014/content')).body
  assert.match(v1, /Carensdag bij deeltijdse bedienden/)
  assert.match(v2, /vanaf de eerste ziektedag/)
})

test('trap: stray copy doc-015 has the same content hash as doc-014 v1.0', () => {
  const { library } = setup()
  assert.equal(library.get('doc-015')!.versions[0].sha256, library.get('doc-014')!.versions[0].sha256)
})

test('traps: ownerless, wrong country, unreviewed and conflicting documents', async () => {
  const { get, library } = setup()
  const fields = async (drive: string, id: string) =>
    (await get(`/v1.0/drives/${drive}/items/${id}/listItem`)).json().fields

  const polderveld = await fields('drive-pay', 'doc-050')
  assert.equal(polderveld.DocumentOwner, 'pieter.devos@example.test')
  assert.equal(library.person('pieter.devos')!.status, 'left')
  assert.equal(polderveld.ApprovalStatus, 'Pending')

  assert.equal((await fields('drive-pay', 'doc-030')).Country, 'NL')
  assert.equal((await fields('drive-pay', 'doc-041')).ApprovalStatus, 'Pending')

  const timeNote = (await get('/v1.0/drives/drive-time/items/doc-071/content')).body
  assert.match(timeNote, /AB-01/)
  assert.equal((await fields('drive-time', 'doc-071')).ApprovalStatus, 'Approved')
})

test('delta pages through a drive, then returns only changed items', async () => {
  const { get, admin } = setup()
  const first = await drain(get, '/v1.0/drives/drive-pay/root/delta', 3)
  assert.equal(first.items.length, 9)
  assert.equal((await drain(get, first.deltaLink)).items.length, 0)

  const edit = await admin('POST', '/admin/documents/doc-050/versions', {
    as: 'lotte.vermeulen',
    content: readFileSync(path('../live/doc-050-v3.md'), 'utf8'),
  })
  assert.equal(edit.statusCode, 201, edit.body)
  assert.equal(edit.json().version, '3.0')
  assert.equal(edit.json().approval.status, 'pending')
  await admin('PUT', '/admin/documents/doc-050/owner', { as: 'katrien.janssens', owner: 'lotte.vermeulen' })

  const next = await drain(get, first.deltaLink)
  assert.deepEqual(next.items.map((i) => i.id), ['doc-050'])
  // Other drives are unaffected.
  assert.equal((await drain(get, '/v1.0/drives/drive-hr/root/delta')).items.length, 2)
})

test('approval applies to the current version; approving twice conflicts', async () => {
  const { admin, get } = setup()
  const ok = await admin('POST', '/admin/documents/doc-041/approval', { as: 'katrien.janssens', status: 'approved' })
  assert.equal(ok.statusCode, 200)
  assert.equal((await get('/v1.0/drives/drive-pay/items/doc-041/listItem')).json().fields.ApprovedBy, 'katrien.janssens@example.test')
  const again = await admin('POST', '/admin/documents/doc-041/approval', { as: 'katrien.janssens', status: 'approved' })
  assert.equal(again.statusCode, 409)
})

test('people who left cannot edit, and cannot become owner', async () => {
  const { admin } = setup()
  assert.equal((await admin('POST', '/admin/documents/doc-050/versions', { as: 'pieter.devos', content: 'x' })).statusCode, 400)
  assert.equal((await admin('PUT', '/admin/documents/doc-021/owner', { as: 'katrien.janssens', owner: 'pieter.devos' })).statusCode, 400)
})

test('upload creates a pending doc; path traversal and duplicates are rejected', async () => {
  const { admin } = setup()
  const base = { as: 'anna.claes', drive: 'pay', title: 'Nota', content: '# Nota' }
  const created = await admin('POST', '/admin/documents', { ...base, path: 'Klanten/Ardenne/Nota.md' })
  assert.equal(created.statusCode, 201, created.body)
  assert.equal(created.json().id, 'doc-081')
  assert.equal((await admin('POST', '/admin/documents', { ...base, path: 'Klanten/Ardenne/Nota.md' })).statusCode, 409)
  assert.equal((await admin('POST', '/admin/documents', { ...base, path: '../secret.md' })).statusCode, 400)
})

test('sharing links from mails resolve to the drive item', async () => {
  const { get } = setup()
  const link = 'https://capydemo.sharepoint.example.test/sites/knowledge/_layouts/15/Doc.aspx?sourcedoc=doc-014&version=2.0'
  const shareId = `u!${Buffer.from(link).toString('base64url')}`
  const item = (await get(`/v1.0/shares/${shareId}/driveItem`)).json()
  assert.equal(item.id, 'doc-014')
  assert.equal(item.parentReference.driveId, 'drive-pay')
  assert.equal(item.name, 'Procedure gewaarborgd loon bedienden.md')
})

test('every document referenced in the mock mailbox exists, at the referenced version', () => {
  const { library } = setup()
  const refs = readFileSync(path('../../mail/mailbox.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => (JSON.parse(line) as { references: string[] }).references)
  for (const ref of refs) {
    const [docId, version] = ref.split('@')
    const doc = library.get(docId)
    assert.ok(doc, `${ref}: unknown document`)
    if (version) assert.ok(doc.versions.some((v) => v.version === version), `${ref}: unknown version`)
  }
})

test('items are only found in their own drive', async () => {
  const { get } = setup()
  assert.equal((await get('/v1.0/drives/drive-hr/items/doc-014')).statusCode, 404)
})

test('unknown delta tokens require a resync (410)', async () => {
  const { get } = setup()
  assert.equal((await get('/v1.0/drives/drive-pay/root/delta?token=Zm9vLjM')).statusCode, 410)
})
