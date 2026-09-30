import { createHash } from 'crypto'
import { sql } from '../db/client.js'
import type { EventInput } from './types.js'

interface VerifyResult {
  valid: boolean
  brokenAt?: string
}

export async function verifyChain(): Promise<VerifyResult> {
  const events = await sql<Array<{
    id: string; ts: Date; actor_id: string; type: string;
    subject_type: string; subject_id: string; domain_id: string | null;
    client_id: string | null; country: string | null; payload: unknown;
    prev_hash: string | null; hash: string;
  }>>`
    SELECT * FROM event ORDER BY ts ASC, id ASC
  `

  let prevHash: string | null = null

  for (const event of events) {
    const input: EventInput = {
      actor_id: event.actor_id,
      type: event.type as EventInput['type'],
      subject_type: event.subject_type as EventInput['subject_type'],
      subject_id: event.subject_id,
      domain_id: event.domain_id ?? undefined,
      client_id: event.client_id ?? undefined,
      country: event.country ?? undefined,
      payload: event.payload as Record<string, unknown>,
    }

    const content: string = JSON.stringify({ prevHash, id: event.id, ts: event.ts, ...input })
    const expected: string = createHash('sha256').update(content).digest('hex')

    if (expected !== event.hash) {
      return { valid: false, brokenAt: event.id }
    }

    prevHash = event.hash
  }

  return { valid: true }
}
