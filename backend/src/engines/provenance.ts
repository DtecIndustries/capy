import { sql } from '../db/client.js'

export interface ProvenanceEvent {
  event_id: string
  // When it happened in the source system; recorded_at is when it entered the ledger.
  ts: Date
  recorded_at: Date
  type: string
  subject_id: string
  actor_id: string
  actor_name: string | null
  payload: unknown
  hash: string
}

export interface ProvenanceResult {
  document_id: string
  title: string | null
  current_version_id: string | null
  owner: { id: string; name: string; status: string } | null
  events: ProvenanceEvent[]
}

// Everything the ledger knows about a document: its versions, approvals, owner changes,
// conflicts it is part of, and mails that link to it.
export async function getProvenance(documentId: string): Promise<ProvenanceResult> {
  const [doc] = await sql<{ title: string; current_version_id: string | null; owner_id: string | null; owner_name: string | null; owner_status: string | null }[]>`
    SELECT d.title, d.current_version_id, p.id AS owner_id, p.name AS owner_name, p.status AS owner_status
    FROM document d LEFT JOIN person p ON p.id = d.owner_id
    WHERE d.id = ${documentId}
  `

  const versionPattern = `${documentId}@%`
  const events = await sql<ProvenanceEvent[]>`
    SELECT
      e.id         AS event_id,
      COALESCE((e.payload->>'occurred_at')::timestamptz, e.ts) AS ts,
      e.ts         AS recorded_at,
      e.type,
      e.subject_id,
      e.actor_id,
      p.name       AS actor_name,
      e.payload,
      e.hash
    FROM event e
    LEFT JOIN person p ON p.id = e.actor_id
    WHERE e.subject_id = ${documentId}
       OR e.subject_id LIKE ${versionPattern}
       OR e.payload->>'with' LIKE ${versionPattern}
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(e.payload->'references', '[]'::jsonb)) r
         WHERE r = ${documentId} OR r LIKE ${versionPattern}
       )
    ORDER BY ts ASC, e.seq ASC
  `

  return {
    document_id: documentId,
    title: doc?.title ?? null,
    current_version_id: doc?.current_version_id ?? null,
    owner: doc?.owner_id ? { id: doc.owner_id, name: doc.owner_name!, status: doc.owner_status! } : null,
    events,
  }
}
