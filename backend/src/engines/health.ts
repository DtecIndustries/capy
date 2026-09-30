import { sql } from '../db/client.js'

export type FindingKind =
  | 'orphaned'
  | 'stale'
  | 'never_reviewed'
  | 'duplicate'
  | 'conflict'
  | 'gap'
  | 'bus_factor'

export interface HealthFinding {
  kind: FindingKind
  subject_id: string
  description: string
  suggested_action: string
}

export interface HealthResult {
  app: string
  domain: string
  findings: HealthFinding[]
}

export async function getHealth(app: string, domainId: string): Promise<HealthResult> {
  const findings: HealthFinding[] = []

  // Orphaned: current document without an owner, or whose owner has left
  const orphaned = await sql<{ document_id: string; title: string; owner_name: string | null }[]>`
    SELECT d.id AS document_id, d.title, p.name AS owner_name
    FROM document d
    JOIN document_area da ON da.document_version_id = d.current_version_id
    LEFT JOIN person p ON p.id = d.owner_id
    WHERE da.domain_id = ${domainId}
      AND d.status = 'current'
      AND (p.id IS NULL OR p.status = 'left')
  `
  for (const r of orphaned) {
    findings.push({
      kind: 'orphaned',
      subject_id: r.document_id,
      description: r.owner_name ? `"${r.title}": owner ${r.owner_name} has left` : `"${r.title}" has no owner`,
      suggested_action: 'Reassign or archive',
    })
  }

  // Duplicate: a current document whose content is identical to another document's version
  const duplicates = await sql<{ document_id: string; title: string; copy_of: string }[]>`
    SELECT d.id AS document_id, d.title, o.id AS copy_of
    FROM document d
    JOIN document_version dv ON dv.id = d.current_version_id
    JOIN document_area da ON da.document_version_id = dv.id
    JOIN document_version o ON o.content_hash = dv.content_hash AND o.document_id <> d.id
    WHERE da.domain_id = ${domainId}
      AND d.status = 'current'
  `
  for (const r of duplicates) {
    findings.push({
      kind: 'duplicate',
      subject_id: r.document_id,
      description: `"${r.title}" is an identical copy of ${r.copy_of}`,
      suggested_action: 'Delete the copy and link to the original',
    })
  }

  // Stale, circulating: a superseded version that was shared in a mail after it was superseded
  const circulating = await sql<{ document_id: string; title: string; old_version: string; mail_id: string }[]>`
    SELECT DISTINCT d.id AS document_id, d.title, ref AS old_version, e.subject_id AS mail_id
    FROM event e
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.payload->'references', '[]'::jsonb)) ref
    JOIN document_version old ON old.id = ref
    JOIN document d ON d.id = old.document_id AND d.current_version_id <> old.id
    JOIN document_version cur ON cur.id = d.current_version_id
    JOIN document_area da ON da.document_version_id = cur.id AND da.domain_id = ${domainId}
    WHERE e.type = 'question_answered'
      AND (e.payload->>'occurred_at')::timestamptz > cur.modified_at
  `
  for (const r of circulating) {
    findings.push({
      kind: 'stale',
      subject_id: r.document_id,
      description: `Superseded ${r.old_version} was still shared in ${r.mail_id}`,
      suggested_action: 'Archive the old version and point to the latest',
    })
  }

  // Stale, outdated: current version not touched for more than 18 months
  const outdated = await sql<{ document_id: string; title: string; modified_at: Date }[]>`
    SELECT d.id AS document_id, d.title, dv.modified_at
    FROM document d
    JOIN document_version dv ON dv.id = d.current_version_id
    JOIN document_area da ON da.document_version_id = dv.id
    WHERE da.domain_id = ${domainId}
      AND d.status = 'current'
      AND dv.modified_at < now() - interval '540 days'
  `
  for (const r of outdated) {
    findings.push({
      kind: 'stale',
      subject_id: r.document_id,
      description: `"${r.title}" has not been updated since ${r.modified_at.toISOString().slice(0, 10)}`,
      suggested_action: 'Ask the owner to review it',
    })
  }

  // Never reviewed: current document with no approval record
  const unreviewed = await sql<{ document_id: string; title: string }[]>`
    SELECT d.id AS document_id, d.title
    FROM document d
    JOIN document_version dv ON dv.id = d.current_version_id
    JOIN document_area da ON da.document_version_id = dv.id
    LEFT JOIN approval ap ON ap.document_version_id = dv.id
    WHERE da.domain_id = ${domainId}
      AND d.status = 'current'
      AND ap.document_version_id IS NULL
  `
  for (const r of unreviewed) {
    findings.push({
      kind: 'never_reviewed',
      subject_id: r.document_id,
      description: `"${r.title}" has never been approved`,
      suggested_action: 'Request review from domain owner',
    })
  }

  // Conflict: open conflict_detected events (both versions still current, no ruling)
  const conflicts = await sql<{ event_id: string; subject_id: string; with_id: string; question: string }[]>`
    SELECT e.id AS event_id, e.subject_id, e.payload->>'with' AS with_id, e.payload->>'question' AS question
    FROM event e
    JOIN document d1 ON d1.current_version_id = e.subject_id
    JOIN document d2 ON d2.current_version_id = e.payload->>'with'
    WHERE e.type = 'conflict_detected'
      AND e.domain_id = ${domainId}
      AND NOT EXISTS (
        SELECT 1 FROM event r
        WHERE r.type = 'ruling_made' AND r.payload->>'conflict_id' = e.id
      )
  `
  for (const r of conflicts) {
    findings.push({
      kind: 'conflict',
      subject_id: r.subject_id,
      description: `${r.subject_id} and ${r.with_id} disagree: ${r.question}`,
      suggested_action: 'Rule on which is correct',
    })
  }

  // Gap: domain has no current trusted document at all
  const [{ count }] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int AS count
    FROM document d
    JOIN document_version dv ON dv.id = d.current_version_id
    JOIN document_area da ON da.document_version_id = dv.id
    JOIN approval ap ON ap.document_version_id = dv.id AND ap.status = 'approved'
    WHERE da.domain_id = ${domainId}
      AND d.status = 'current'
  `
  if (count === 0) {
    findings.push({
      kind: 'gap',
      subject_id: domainId,
      description: 'No trusted document exists for this domain',
      suggested_action: 'Commission a new document',
    })
  }

  // Bus factor: fewer than 2 active people have contributed events in this domain
  const [{ experts }] = await sql<[{ experts: number }]>`
    SELECT COUNT(DISTINCT e.actor_id)::int AS experts
    FROM event e
    JOIN person p ON p.id = e.actor_id
    WHERE (e.domain_id = ${domainId} OR COALESCE(e.payload->'domains', '[]'::jsonb) ? ${domainId})
      AND p.status = 'active'
  `
  if (experts < 2) {
    findings.push({
      kind: 'bus_factor',
      subject_id: domainId,
      description: `Only ${experts} active person has knowledge of this domain`,
      suggested_action: 'Capture session and pair a second person',
    })
  }

  return { app, domain: domainId, findings }
}
