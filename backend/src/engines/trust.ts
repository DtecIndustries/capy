import { sql } from '../db/client.js'
import type { ConflictInfo, TrustContext, TrustResult, TrustSignals, Verdict, ScopeMatch, Freshness } from './trust.types.js'

interface DocumentRow {
  document_id: string
  document_version_id: string
  title: string
  version: string
  is_current_version: boolean
  document_status: string
  modified_at: Date
  country: string | null         // the requested client's country
  doc_client_id: string | null   // the client filter on document_area
  area_country: string | null
  approval_status: string | null
  approved_at: Date | null
  approver_name: string | null
  approver_team_id: string | null
  owner_team_id: string
  owner_id: string | null
  owner_name: string | null
  owner_status: string | null
  copy_of: string | null
}

const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function computeSignals(row: DocumentRow, requestedClient: string, conflicted: Map<string, ConflictInfo[]>): TrustSignals {
  const freshness: Freshness = row.is_current_version && row.document_status === 'current' ? 'latest' : 'superseded'
  const approved_by_owner_team = row.approval_status === 'approved' && row.approver_team_id === row.owner_team_id
  const owner_active = row.owner_status === 'active'

  let scope_match: ScopeMatch
  if (row.doc_client_id !== null && row.doc_client_id !== requestedClient) {
    scope_match = 'wrong-client'
  } else if (row.area_country !== null && row.country !== null && row.area_country !== row.country) {
    scope_match = 'wrong-country'
  } else if (row.doc_client_id === requestedClient) {
    scope_match = 'client-specific'
  } else {
    scope_match = 'generic'
  }

  const consistent_with_siblings = !conflicted.has(row.document_version_id)
  return { freshness, approved_by_owner_team, owner_active, scope_match, consistent_with_siblings, copy_of: row.copy_of }
}

// Most serious problem first; "unverified" is still shown, but after trusted documents.
function computeVerdict(signals: TrustSignals): Verdict {
  if (signals.scope_match === 'wrong-client' || signals.scope_match === 'wrong-country') return 'scope_mismatch'
  if (signals.freshness === 'superseded' || signals.copy_of) return 'stale'
  if (!signals.owner_active) return 'unowned'
  if (!signals.consistent_with_siblings) return 'conflict'
  if (!signals.approved_by_owner_team) return 'unverified'
  return 'trusted'
}

function buildReasons(signals: TrustSignals, row: DocumentRow, conflicts: ConflictInfo[]): string[] {
  const reasons: string[] = []

  if (signals.copy_of) reasons.push(`Copy of ${signals.copy_of}, which has been superseded`)
  else if (signals.freshness === 'latest') reasons.push(`Latest version (${row.version})`)
  else reasons.push(`Superseded: version ${row.version} is no longer current`)

  if (signals.approved_by_owner_team) {
    reasons.push(`Approved by ${row.approver_name} (owning team) on ${formatDate(row.approved_at!)}`)
  } else if (row.approval_status === 'approved') {
    reasons.push(`Approved by ${row.approver_name}, who is not in the team that owns this domain`)
  } else {
    reasons.push('Not approved by the owning team')
  }

  if (!row.owner_id) reasons.push('No owner')
  else if (!signals.owner_active) reasons.push(`Owner ${row.owner_name} has left`)
  else reasons.push(`Owned by ${row.owner_name}`)

  if (signals.scope_match === 'client-specific') reasons.push('Specific to this client')
  else if (signals.scope_match === 'wrong-client') reasons.push('Applies to a different client')
  else if (signals.scope_match === 'wrong-country') reasons.push(`Applies to ${row.area_country}, not ${row.country}`)
  else reasons.push('Generic, not client-specific')

  for (const c of conflicts) {
    reasons.push(`Contradicts ${c.with}: "${c.question}" This says ${c.this_says}, it says ${c.other_says}`)
  }
  return reasons
}

// Open conflicts in this domain: both versions still current and no ruling made. Both sides
// of a conflict are marked.
async function getConflicts(domainId: string): Promise<Map<string, ConflictInfo[]>> {
  const rows = await sql<{ subject_id: string; with_id: string; question: string; answers: Record<string, { answer: string }> }[]>`
    SELECT e.subject_id, e.payload->>'with' AS with_id, e.payload->>'question' AS question, e.payload->'answers' AS answers
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
  const conflicts = new Map<string, ConflictInfo[]>()
  const add = (id: string, info: ConflictInfo) => conflicts.set(id, [...(conflicts.get(id) ?? []), info])
  for (const r of rows) {
    const a = r.answers[r.subject_id]?.answer ?? '?'
    const b = r.answers[r.with_id]?.answer ?? '?'
    add(r.subject_id, { with: r.with_id, question: r.question, this_says: a, other_says: b })
    add(r.with_id, { with: r.subject_id, question: r.question, this_says: b, other_says: a })
  }
  return conflicts
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
      dv.modified_at,
      c.country,
      da.client_id                                  AS doc_client_id,
      da.country                                    AS area_country,
      ap.status                                     AS approval_status,
      ap.at                                         AS approved_at,
      approver.name                                 AS approver_name,
      approver.team_id                              AS approver_team_id,
      dom.owner_team_id,
      owner_p.id                                    AS owner_id,
      owner_p.name                                  AS owner_name,
      owner_p.status                                AS owner_status,
      (SELECT o.id FROM document_version o
         JOIN document od ON od.id = o.document_id
        WHERE o.content_hash = dv.content_hash AND o.document_id <> dv.document_id
          AND od.current_version_id <> o.id
        LIMIT 1)                                    AS copy_of
    FROM document_area da
    JOIN domain dom          ON dom.id = da.domain_id
    JOIN document_version dv ON dv.id = da.document_version_id
    JOIN document d          ON d.id = dv.document_id
    JOIN client c            ON c.id = ${ctx.client}
    LEFT JOIN person owner_p ON owner_p.id = d.owner_id
    LEFT JOIN approval ap    ON ap.document_version_id = dv.id
    LEFT JOIN person approver ON approver.id = ap.by_person_id
    WHERE da.domain_id = ${ctx.domain}
      AND dom.app_id = ${ctx.app}
      AND (da.client_id IS NULL OR da.client_id = ${ctx.client})
  `

  if (rows.length === 0) return []

  const conflicts = await getConflicts(ctx.domain)

  const results: TrustResult[] = rows.map((row) => {
    const signals = computeSignals(row, ctx.client, conflicts)
    const verdict = computeVerdict(signals)
    const rowConflicts = conflicts.get(row.document_version_id) ?? []
    return {
      document_id: row.document_id,
      document_version_id: row.document_version_id,
      title: row.title,
      version: row.version,
      rank: 0,
      verdict,
      signals,
      reasons: buildReasons(signals, row, rowConflicts),
      excluded: verdict !== 'trusted' && verdict !== 'unverified',
      owner: row.owner_id ? { id: row.owner_id, name: row.owner_name!, status: row.owner_status! } : null,
      conflicts: rowConflicts,
    }
  })

  // Rank: by verdict, then client-specific above generic, then newest first
  const order: Verdict[] = ['trusted', 'unverified', 'conflict', 'unowned', 'stale', 'scope_mismatch']
  const modified = new Map(rows.map((r) => [r.document_version_id, r.modified_at.getTime()]))
  results.sort((a, b) => {
    const vd = order.indexOf(a.verdict) - order.indexOf(b.verdict)
    if (vd !== 0) return vd
    const sa = a.signals.scope_match === 'client-specific' ? 0 : 1
    const sb = b.signals.scope_match === 'client-specific' ? 0 : 1
    if (sa !== sb) return sa - sb
    return modified.get(b.document_version_id)! - modified.get(a.document_version_id)!
  })

  results.forEach((r, i) => { r.rank = i + 1 })

  return results
}
