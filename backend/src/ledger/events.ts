import { createHash, randomUUID } from 'crypto'
import { sql } from '../db/client.js'
import type { EventInput, LedgerEvent } from './types.js'

function computeHash(prevHash: string | null, input: EventInput, id: string, ts: Date): string {
  const content = JSON.stringify({ prevHash, id, ts, ...input })
  return createHash('sha256').update(content).digest('hex')
}

export async function appendEvent(input: EventInput): Promise<LedgerEvent> {
  const id = randomUUID()
  const ts = new Date()

  const [tail] = await sql<[{ hash: string } | undefined]>`
    SELECT hash FROM event ORDER BY ts DESC, id DESC LIMIT 1
  `
  const prevHash = tail?.hash ?? null
  const hash = computeHash(prevHash, input, id, ts)

  await sql`
    INSERT INTO event (id, ts, actor_id, type, subject_type, subject_id,
                       domain_id, client_id, country, payload, prev_hash, hash)
    VALUES (
      ${id}, ${ts}, ${input.actor_id}, ${input.type},
      ${input.subject_type}, ${input.subject_id},
      ${input.domain_id ?? null}, ${input.client_id ?? null},
      ${input.country ?? null}, ${JSON.stringify(input.payload ?? {})},
      ${prevHash}, ${hash}
    )
  `

  return { ...input, id, ts, prev_hash: prevHash, hash }
}
