import { sql } from '../db/client.js'
import { appendEvent } from '../ledger/events.js'
import { readSeed } from './seed.js'

// Flags contradictions: two current, approved documents in the same domain, with
// overlapping scope, that give different answers to one of the domain's known questions
// (taxonomy claims). Drafts and copies are left to the stale/unreviewed checks. A conflict
// is recorded once; it stops counting when either version is superseded or a ruling is made.

interface ClaimRow {
  version_id: string
  domain_id: string
  claim_id: string
  answer: string
  evidence: string
  client_id: string | null
  country: string | null
  modified_at: Date
}

const overlaps = (a: string | null, b: string | null) => a === null || b === null || a === b

export async function detectConflicts(): Promise<number> {
  const rows = await sql<ClaimRow[]>`
    SELECT c.document_version_id AS version_id, c.domain_id, c.claim_id, c.answer, c.evidence,
           da.client_id, da.country, dv.modified_at
    FROM document_claim c
    JOIN document d          ON d.current_version_id = c.document_version_id
    JOIN document_version dv ON dv.id = c.document_version_id
    JOIN approval ap         ON ap.document_version_id = c.document_version_id AND ap.status = 'approved'
    JOIN document_area da    ON da.document_version_id = c.document_version_id AND da.domain_id = c.domain_id
    ORDER BY dv.modified_at
  `
  const questions = new Map(
    readSeed().taxonomy.domains.flatMap((d) => (d.claims ?? []).map((c) => [c.id, c.question] as const)),
  )

  let recorded = 0
  for (const [i, a] of rows.entries()) {
    for (const b of rows.slice(i + 1)) {
      if (a.domain_id !== b.domain_id || a.claim_id !== b.claim_id || a.answer === b.answer) continue
      if (!overlaps(a.client_id, b.client_id) || !overlaps(a.country, b.country)) continue

      // The newer document is the one that introduced the disagreement.
      const [newer, older] = b.modified_at >= a.modified_at ? [b, a] : [a, b]
      const [already] = await sql`
        SELECT 1 FROM event WHERE type = 'conflict_detected'
          AND ((subject_id = ${newer.version_id} AND payload->>'with' = ${older.version_id})
            OR (subject_id = ${older.version_id} AND payload->>'with' = ${newer.version_id}))
      `
      if (already) continue

      await appendEvent({
        actor_id: 'capy:rules',
        type: 'conflict_detected',
        subject_type: 'document',
        subject_id: newer.version_id,
        domain_id: newer.domain_id,
        client_id: newer.client_id ?? older.client_id ?? undefined,
        country: newer.country ?? older.country ?? undefined,
        payload: {
          occurred_at: new Date().toISOString(),
          with: older.version_id,
          claim: newer.claim_id,
          question: questions.get(newer.claim_id) ?? newer.claim_id,
          answers: {
            [newer.version_id]: { answer: newer.answer, evidence: newer.evidence },
            [older.version_id]: { answer: older.answer, evidence: older.evidence },
          },
        },
      })
      recorded++
    }
  }
  return recorded
}
