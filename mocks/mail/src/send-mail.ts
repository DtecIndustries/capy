import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

// Sends a live mail into the running mail mock, for demo moments.
// A --file preset and individual flags can be combined; flags win.

const USAGE = `Usage:
  send-mail --file live/01-ruling-client-x-sick-leave.json
  send-mail --from sophie.dubois --to anna.claes --body "..." [options]

Options:
  --file <path>         JSON preset (same fields as the flags, see live/)
  --from <person-id>    Sender (must be an active person in the directory)
  --to <id,id>          Recipients, comma separated
  --cc <id,id>          Cc recipients, comma separated
  --subject <text>      Required for a new thread; defaults to "Re: ..." for replies
  --body <text>         Mail body
  --reply-to <mail-id>  Reply within the thread of this mail
  --ref <doc-id[@ver]>  Referenced SharePoint document, repeatable
  --importance <level>  low | normal | high
  --language <code>     en | nl | fr

Environment:
  MAIL_MOCK_URL          default http://localhost:4010
  MAIL_MOCK_ADMIN_TOKEN  required`

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    cc: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
    'reply-to': { type: 'string' },
    ref: { type: 'string', multiple: true },
    importance: { type: 'string' },
    language: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || process.argv.length <= 2) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

const list = (value: string | undefined) => value?.split(',').map((s) => s.trim()).filter(Boolean)

const preset = values.file ? JSON.parse(readFileSync(values.file, 'utf8')) : {}
const flags = {
  from: values.from,
  to: list(values.to),
  cc: list(values.cc),
  subject: values.subject,
  body: values.body?.replace(/\\n/g, '\n'),
  is_reply_to: values['reply-to'],
  references: values.ref,
  importance: values.importance,
  language: values.language,
}
const payload = { ...preset, ...Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined)) }

const token = process.env.MAIL_MOCK_ADMIN_TOKEN
if (!token) {
  console.error('MAIL_MOCK_ADMIN_TOKEN is not set')
  process.exit(1)
}

const url = `${process.env.MAIL_MOCK_URL ?? 'http://localhost:4010'}/admin/messages`
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
})
const result = await res.json()

if (!res.ok) {
  console.error(`Failed (${res.status}):`, result.error?.message ?? result.message ?? result)
  process.exit(1)
}

const { record } = result
console.log(`Sent ${record.id} in ${record.thread_id} (seq ${result.seq})`)
console.log(`  ${record.from} -> ${record.to.join(', ')}: ${record.subject}`)
if (record.references.length) console.log(`  references: ${record.references.join(', ')}`)
