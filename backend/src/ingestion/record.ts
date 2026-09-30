import { appendEvent } from '../ledger/events.js'
import type { EventInput } from '../ledger/types.js'
import type { ChangeEvent } from './contract.js'

// Turns change events into ledger events. The ledger's own ts is the ingestion time (it
// orders the hash chain); when it happened in the source is kept as payload.occurred_at.
function toLedger(change: ChangeEvent): EventInput[] {
  const base = {
    actor_id: change.actor,
    country: change.country ?? undefined,
    domain_id: change.domain_id ?? undefined,
    client_id: change.client_id ?? undefined,
    payload: {
      occurred_at: change.timestamp,
      source_type: change.source_type,
      ...(change.content_hash && { content_hash: change.content_hash }),
      ...(change.pointer && { pointer: change.pointer }),
      ...(change.location && { location: change.location }),
      ...change.details,
    },
  }
  const document = { ...base, subject_type: 'document' as const, subject_id: change.raw_ref ?? change.source_id }

  switch (change.action) {
    case 'created':
      return [{ ...document, type: 'source_created' }]
    case 'edited': {
      const previous = change.details?.from_version as string | undefined
      const superseded: EventInput[] = previous
        ? [{ ...base, type: 'source_superseded', subject_type: 'document', subject_id: `${change.source_id}@${previous}` }]
        : []
      return [{ ...document, type: 'source_edited' }, ...superseded]
    }
    case 'approved':
      return [{ ...document, type: 'source_approved' }]
    case 'owner_changed':
      return [{ ...base, type: 'owner_changed', subject_type: 'document', subject_id: change.source_id }]
    case 'replied':
      return [{ ...base, type: 'question_answered', subject_type: 'mail', subject_id: change.source_id }]
    case 'person_left':
      return [{ ...base, type: 'person_left', subject_type: 'person', subject_id: change.source_id }]
  }
}

// Appends one at a time, oldest first: appendEvent reads the chain tail, so it must not run concurrently.
export async function record(changes: ChangeEvent[]): Promise<number> {
  const sorted = [...changes].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  let count = 0
  for (const change of sorted) {
    for (const event of toLedger(change)) {
      await appendEvent(event)
      count++
    }
  }
  return count
}
