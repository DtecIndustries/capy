import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

// Changes documents in the running SharePoint mock, for demo moments.

const USAGE = `Usage:
  sp edit <doc-id> --as <person> --file <path.md> [--minor]
  sp approve <doc-id> --as <person> [--reject]
  sp set-owner <doc-id> --owner <person> --as <person>
  sp upload --as <person> --drive <pay|time|hr> --path <folder/name.md> --title <text> --file <path.md>
            [--type <document type>] [--country <BE|NL|FR>] [--owner <person>]

Environment:
  SHAREPOINT_MOCK_URL          default http://localhost:4020
  SHAREPOINT_MOCK_ADMIN_TOKEN  required`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    as: { type: 'string' },
    file: { type: 'string' },
    minor: { type: 'boolean' },
    reject: { type: 'boolean' },
    owner: { type: 'string' },
    drive: { type: 'string' },
    path: { type: 'string' },
    title: { type: 'string' },
    type: { type: 'string' },
    country: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

const [command, docId] = positionals

function usage(code: number): never {
  console.log(USAGE)
  process.exit(code)
}

function need<T>(value: T | undefined, flag: string): T {
  if (value === undefined) {
    console.error(`Missing ${flag}`)
    usage(1)
  }
  return value
}

if (values.help) usage(0)

const readContent = () => readFileSync(need(values.file, '--file'), 'utf8')

let request: { method: string; path: string; body: object }
switch (command) {
  case 'edit':
    request = {
      method: 'POST',
      path: `/admin/documents/${encodeURIComponent(need(docId, '<doc-id>'))}/versions`,
      body: { as: need(values.as, '--as'), content: readContent(), ...(values.minor ? { minor: true } : {}) },
    }
    break
  case 'approve':
    request = {
      method: 'POST',
      path: `/admin/documents/${encodeURIComponent(need(docId, '<doc-id>'))}/approval`,
      body: { as: need(values.as, '--as'), status: values.reject ? 'rejected' : 'approved' },
    }
    break
  case 'set-owner':
    request = {
      method: 'PUT',
      path: `/admin/documents/${encodeURIComponent(need(docId, '<doc-id>'))}/owner`,
      body: { as: need(values.as, '--as'), owner: need(values.owner, '--owner') },
    }
    break
  case 'upload':
    request = {
      method: 'POST',
      path: '/admin/documents',
      body: {
        as: need(values.as, '--as'),
        drive: need(values.drive, '--drive'),
        path: need(values.path, '--path'),
        title: need(values.title, '--title'),
        content: readContent(),
        ...(values.type ? { document_type: values.type } : {}),
        ...(values.country ? { country: values.country } : {}),
        ...(values.owner ? { owner: values.owner } : {}),
      },
    }
    break
  default:
    usage(1)
}

const token = process.env.SHAREPOINT_MOCK_ADMIN_TOKEN
if (!token) {
  console.error('SHAREPOINT_MOCK_ADMIN_TOKEN is not set')
  process.exit(1)
}

const res = await fetch(`${process.env.SHAREPOINT_MOCK_URL ?? 'http://localhost:4020'}${request.path}`, {
  method: request.method,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(request.body),
})
const result = await res.json()

if (!res.ok) {
  console.error(`Failed (${res.status}):`, result.error?.message ?? result)
  process.exit(1)
}

console.log(`${command}: ${result.id} v${result.version} (${result.approval.status}) owner ${result.owner}`)
console.log(`  ${result.drive}/${result.path}`)
