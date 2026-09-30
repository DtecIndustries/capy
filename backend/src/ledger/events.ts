import { randomUUID } from 'crypto'
import { sql } from '../db/client.js'
import { hashEvent } from './hash.js'
import type { EventInput, LedgerEvent } from './types.js'

// Serialises appends across connections, so two writers can't chain onto the same tail.
const LEDGER_LOCK = 4242

export async function appendEvent(input: EventInput): Promise<LedgerEvent> {
  const id = randomUUID()
  // Postgres keeps microseconds, JS Dates milliseconds; both round-trip this value exactly.
  const ts = new Date()
  const payload = input.payload ?? {}

  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LEDGER_LOCK})`
    const [tail] = await tx<{ hash: string }[]>`SELECT hash FROM event ORDER BY seq DESC LIMIT 1`
    const prevHash = tail?.hash ?? null
    const hash = hashEvent(prevHash, id, ts, input)

    await tx`
      INSERT INTO event (id, ts, actor_id, type, subject_type, subject_id,
                         domain_id, client_id, country, payload, prev_hash, hash)
      VALUES (
        ${id}, ${ts}, ${input.actor_id}, ${input.type},
        ${input.subject_type}, ${input.subject_id},
        ${input.domain_id ?? null}, ${input.client_id ?? null},
        ${input.country ?? null}, ${tx.json(payload as Parameters<typeof tx.json>[0])},
        ${prevHash}, ${hash}
      )
    `
    return { ...input, id, ts, prev_hash: prevHash, hash }
  })
}
