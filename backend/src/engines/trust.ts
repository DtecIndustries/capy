import { sql } from '../db/client.js'
import type { TrustContext, TrustResult, TrustSignals, Verdict, ScopeMatch, Freshness } from './trust.types.js'

interface DocumentRow {
  document_id: string
  document_version_id: string
  title: string
  version: string
  is_current_version: boolean
  document_status: string
  author_id: string
  modified_at: Date
  client_id: string | null
  country: string | null
  doc_client_id: string | null   // the client filter on document_area
  area_country: string | null
  approval_status: string | null
  approved_by: string | null
  approver_team_id: string | null
  author_status: string | null
  approver_status: string | null
  owner_team_id: string
}

function computeSignals(row: DocumentRow, requestedClient: string, conflictedIds: Set<string>): TrustSignals {
  const freshness: Freshness = row.is_current_version && row.document_status === 'current' ? 'latest' : 'superseded'

  const approved_by_owner_team =
    row.approval_status === 'approved' && row.approver_team_id === row.owner_team_id

  const owner_active =
    (row.author_status === 'active') &&
    (row.approval_status !== 'approved' || row.approver_status === 'active')

  let scope_match: ScopeMatch
  if (row.doc_client_id !== null && row.doc_client_id !== requestedClient) {
    scope_match = 'wrong-client'
  } else if (row.area_country !== null && row.area_country !== row.country) {
    scope_match = 'wrong-country'
  } else if (row.doc_client_id === requestedClient) {
    scope_match = 'client-specific'
  } else {
    scope_match = 'generic'
  }

  const consistent_with_siblings = !conflictedIds.has(row.document_version_id)

  return { freshness, approved_by_owner_team, owner_active, scope_match, consistent_with_siblings }
}

function computeVerdict(signals: TrustSignals): Verdict {
  if (signals.scope_match === 'wrong-client' || signals.scope_match === 'wrong-country') return 'scope_mismatch'
  if (signals.freshness === 'superseded') return 'stale'
  if (!signals.owner_active) return 'unowned'
  if (!signals.consistent_with_siblings) return 'conflict'
  return 'trusted'
}

function buildReasons(signals: TrustSignals, row: DocumentRow): string[] {
  const reasons: string[] = []

  if (signals.freshness === 'latest') reasons.push(`Latest version (${row.version})`)
  else reasons.push(`Superseded — version ${row.version} is no longer current`)

  if (signals.approved_by_owner_team) {
    const date = row.modified_at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    reasons.push(`Approved by owning team on ${date}`)
  } else {
    reasons.push('Not approved by owning team')
  }

  if (!signals.owner_active) reasons.push('Owner or approver has left the team')

  if (signals.scope_match === 'client-specific') reasons.push(`Specific to requested client`)
  else if (signals.scope_match === 'wrong-client') reasons.push('Applies to a different client')
  else if (signals.scope_match === 'wrong-country') reasons.push('Applies to a different country')

  if (!signals.consistent_with_siblings) reasons.push('Conflicts with another current document in this domain')

  return reasons
}

// Documents involved in an unresolved conflict_detected event in this domain
async function getConflictedVersionIds(domainId: string): Promise<Set<string>> {
  const rows = await sql<{ subject_id: string }[]>`
    SELECT DISTINCT e.subject_id
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
  return new Set(rows.map(r => r.subject_id))
}

export async function getTrustedDocs(ctx: TrustContext): Promise<TrustResult[]> {
  const rows = await sql<DocumentRow[]>`
    SELECT
      d.id                                          AS document_id,
      dv.id                                         AS document_version_id,
      d.title,
      dv.version,
      (d.current_version_id = dv.id)                AS is_current_version,
      d.status                                      AS document_status,
      dv.author_id,
      dv.modified_at,
      c.country,
      da.client_id                                  AS doc_client_id,
      da.country                                    AS area_country,
      ap.status                                     AS approval_status,
      ap.by_person_id                               AS approved_by,
      approver.team_id                              AS approver_team_id,
      author_p.status                               AS author_status,
      approver.status                               AS approver_status,
      dom.owner_team_id
    FROM document_area da
    JOIN domain dom        ON dom.id = da.domain_id
    JOIN document_version dv ON dv.id = da.document_version_id
    JOIN document d        ON d.id = dv.document_id
    JOIN client c          ON c.id = ${ctx.client}
    JOIN person author_p   ON author_p.id = dv.author_id
    LEFT JOIN approval ap  ON ap.document_version_id = dv.id
    LEFT JOIN person approver ON approver.id = ap.by_person_id
    WHERE da.domain_id = ${ctx.domain}
      AND (da.client_id IS NULL OR da.client_id = ${ctx.client})
  `

  if (rows.length === 0) return []

  const conflictedIds = await getConflictedVersionIds(ctx.domain)

  const results: TrustResult[] = rows.map(row => {
    const signals = computeSignals(row, ctx.client, conflictedIds)
    const verdict = computeVerdict(signals)
    const reasons = buildReasons(signals, row)
    const excluded = verdict !== 'trusted'

    return {
      document_id: row.document_id,
      document_version_id: row.document_version_id,
      title: row.title,
      version: row.version,
      rank: 0,
      verdict,
      signals,
      reasons,
      excluded,
    }
  })

  // Rank: trusted first, then client-specific above generic, then by modified date
  const order: Verdict[] = ['trusted', 'conflict', 'unowned', 'stale', 'scope_mismatch']
  results.sort((a, b) => {
    const vd = order.indexOf(a.verdict) - order.indexOf(b.verdict)
    if (vd !== 0) return vd
    const sa = a.signals.scope_match === 'client-specific' ? 0 : 1
    const sb = b.signals.scope_match === 'client-specific' ? 0 : 1
    return sa - sb
  })

  results.forEach((r, i) => { r.rank = i + 1 })

  return results
}
