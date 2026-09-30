import { createHash } from 'crypto'
import type { EventInput } from './types.js'

// JSON with object keys sorted at every level, so the same event always serialises the same
// way, also after a round trip through Postgres JSONB (which reorders keys).
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

// hash = H(prev_hash + event), shared by appendEvent and verifyChain.
export function hashEvent(prevHash: string | null, id: string, ts: Date, input: EventInput): string {
  const content = canonical({
    prevHash,
    id,
    ts: ts.toISOString(),
    actor_id: input.actor_id,
    type: input.type,
    subject_type: input.subject_type,
    subject_id: input.subject_id,
    domain_id: input.domain_id ?? null,
    client_id: input.client_id ?? null,
    country: input.country ?? null,
    payload: input.payload ?? {},
  })
  return createHash('sha256').update(content).digest('hex')
}
