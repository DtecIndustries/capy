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

  // Orphaned: current document version whose author has left
  const orphaned = await sql<{ document_id: string; title: string }[]>`
    SELECT d.id AS document_id, d.title
    FROM document d
    JOIN document_version dv ON dv.id = d.current_version_id
    JOIN person p ON p.id = dv.author_id
    JOIN document_area da ON da.document_version_id = dv.id
    WHERE da.domain_id = ${domainId}
      AND d.status = 'current'
      AND p.status = 'left'
  `
  for (const r of orphaned) {
    findings.push({
      kind: 'orphaned',
      subject_id: r.document_id,
      description: `"${r.title}" has no active owner`,
      suggested_action: 'Reassign or archive',
    })
  }

  // Stale: a newer version exists but the old one is still referenced in document_area
  const stale = await sql<{ document_id: string; title: string }[]>`
    SELECT DISTINCT d.id AS document_id, d.title
    FROM document d
    JOIN document_version dv ON dv.document_id = d.id
    JOIN document_area da ON da.document_version_id = dv.id
    WHERE da.domain_id = ${domainId}
      AND d.status = 'current'
      AND dv.id != d.current_version_id
  `
  for (const r of stale) {
    findings.push({
      kind: 'stale',
      subject_id: r.document_id,
      description: `"${r.title}" has an older version still circulating`,
      suggested_action: 'Archive old version and point to latest',
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

  // Conflict: unresolved conflict_detected events in this domain
  const conflicts = await sql<{ event_id: string; subject_id: string }[]>`
    SELECT e.id AS event_id, e.subject_id
    FROM event e
    WHERE e.type = 'conflict_detected'
      AND e.domain_id = ${domainId}
      AND NOT EXISTS (
        SELECT 1 FROM event r
        WHERE r.type = 'ruling_made'
          AND r.domain_id = ${domainId}
          AND r.payload->>'conflict_id' = e.id
      )
  `
  for (const r of conflicts) {
    findings.push({
      kind: 'conflict',
      subject_id: r.subject_id,
      description: 'Two current documents in this domain contradict each other',
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
    WHERE e.domain_id = ${domainId}
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
