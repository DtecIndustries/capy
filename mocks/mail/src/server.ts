import { fileURLToPath } from 'node:url'
import { buildApp } from './app.js'
import { loadDirectory, loadMailbox } from './mailbox.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable ${name}`)
    process.exit(1)
  }
  return value
}

const defaultPath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

const directory = loadDirectory(process.env.DIRECTORY_PATH ?? defaultPath('../../seed/directory.json'))
const mailbox = loadMailbox(process.env.MAILBOX_PATH ?? defaultPath('../mailbox.jsonl'), directory)

const app = buildApp({
  mailbox,
  token: requireEnv('MAIL_MOCK_TOKEN'),
  adminToken: requireEnv('MAIL_MOCK_ADMIN_TOKEN'),
  sharepointBaseUrl: process.env.SHAREPOINT_BASE_URL ?? 'https://capydemo.sharepoint.example.test/sites/knowledge',
  logger: true,
})

const port = Number(process.env.PORT ?? 4010)

try {
  await app.listen({ port, host: '0.0.0.0' })
  app.log.info(`mail mock serving ${mailbox.lastSeq} messages`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
