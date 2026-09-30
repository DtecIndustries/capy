import { sql } from '../db/client.js'

export interface ProvenanceEvent {
  event_id: string
  ts: Date
  type: string
  actor_id: string
  actor_name: string
  payload: unknown
}

export interface ProvenanceResult {
  document_id: string
  title: string | null
  events: ProvenanceEvent[]
}

export async function getProvenance(documentId: string): Promise<ProvenanceResult> {
  const [doc] = await sql<[{ title: string } | undefined]>`
    SELECT title FROM document WHERE id = ${documentId}
  `

  const events = await sql<ProvenanceEvent[]>`
    SELECT
      e.id         AS event_id,
      e.ts,
      e.type,
      e.actor_id,
      p.name       AS actor_name,
      e.payload
    FROM event e
    JOIN person p ON p.id = e.actor_id
    WHERE e.subject_id LIKE ${documentId + '%'}
       OR e.subject_id = ${documentId}
    ORDER BY e.ts ASC
  `

  return {
    document_id: documentId,
    title: doc?.title ?? null,
    events,
  }
}
