import { fileURLToPath } from 'node:url'
import { buildApp } from './app.js'
import { loadLibrary, type Directory } from './library.js'
import { readFileSync } from 'node:fs'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable ${name}`)
    process.exit(1)
  }
  return value
}

const defaultPath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

const directory = JSON.parse(
  readFileSync(process.env.DIRECTORY_PATH ?? defaultPath('../../seed/directory.json'), 'utf8'),
) as Directory
const library = loadLibrary(process.env.SHAREPOINT_META_PATH ?? defaultPath('../sharepoint.meta.json'), directory)

const app = buildApp({
  library,
  token: requireEnv('SHAREPOINT_MOCK_TOKEN'),
  adminToken: requireEnv('SHAREPOINT_MOCK_ADMIN_TOKEN'),
  logger: true,
})

const port = Number(process.env.PORT ?? 4020)

try {
  await app.listen({ port, host: '0.0.0.0' })
  app.log.info(`sharepoint mock serving ${library.size} documents`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
