import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { sql } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function migrate() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await sql.unsafe(schema)
}
