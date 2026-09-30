import { sql } from '../db/client.js'
import { hashEvent } from './hash.js'
import type { EventInput } from './types.js'

interface VerifyResult {
  valid: boolean
  brokenAt?: string
}

export async function verifyChain(): Promise<VerifyResult> {
  const events = await sql<Array<{
    id: string; ts: Date; actor_id: string; type: string;
    subject_type: string; subject_id: string; domain_id: string | null;
    client_id: string | null; country: string | null; payload: Record<string, unknown>;
    prev_hash: string | null; hash: string;
  }>>`
    SELECT * FROM event ORDER BY seq ASC
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
      payload: event.payload,
    }

    if (event.prev_hash !== prevHash || hashEvent(prevHash, event.id, event.ts, input) !== event.hash) {
      return { valid: false, brokenAt: event.id }
    }

    prevHash = event.hash
  }

  return { valid: true }
}
