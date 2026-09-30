import { sql } from '../db/client.js'
import type { ExpertiseContext, ExpertResult, EvidenceRow } from './expertise.types.js'

// How much each event type contributes before recency decay. Reassigning an owner is
// administration, not knowledge, so owner_changed does not count.
const EVENT_WEIGHTS: Record<string, number> = {
  ruling_made:      1.0,
  source_approved:  0.7,
  source_edited:    0.4,
  source_created:   0.3,
  question_answered: 0.2,
}

const DECAY_HALF_LIFE_DAYS = 180

function recencyWeight(ts: Date): number {
  const ageDays = Math.max(0, Date.now() - ts.getTime()) / (1000 * 60 * 60 * 24)
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS)
}

interface EventRow {
  event_id: string
  actor_id: string
  person_name: string
  team_id: string
  type: string
  subject_id: string
  client_id: string | null
  ts: Date
}

export async function getExperts(ctx: ExpertiseContext): Promise<ExpertResult[]> {
  // Events in this domain for this client (or generic), by active people bound to this client.
  // Time is when it happened in the source, not when we ingested it.
  const rows = await sql<EventRow[]>`
    SELECT
      e.id   AS event_id,
      e.actor_id,
      p.name AS person_name,
      p.team_id,
      e.type,
      e.subject_id,
      e.client_id,
      COALESCE((e.payload->>'occurred_at')::timestamptz, e.ts) AS ts
    FROM event e
    JOIN person p ON p.id = e.actor_id AND p.status = 'active'
    JOIN client_binding cb ON cb.person_id = p.id AND cb.client_id = ${ctx.client}
    JOIN domain dom ON dom.id = ${ctx.domain} AND dom.app_id = ${ctx.app}
    WHERE (e.domain_id = ${ctx.domain} OR COALESCE(e.payload->'domains', '[]'::jsonb) ? ${ctx.domain})
      AND (e.client_id IS NULL OR e.client_id = ${ctx.client})
      AND e.type = ANY(${Object.keys(EVENT_WEIGHTS)}::text[])
    ORDER BY e.actor_id, ts DESC
  `

  // Group by person
  const byPerson = new Map<string, { name: string; team_id: string; events: EventRow[] }>()
  for (const row of rows) {
    if (!byPerson.has(row.actor_id)) {
      byPerson.set(row.actor_id, { name: row.person_name, team_id: row.team_id, events: [] })
    }
    byPerson.get(row.actor_id)!.events.push(row)
  }

  const results: ExpertResult[] = []

  for (const [person_id, { name, team_id, events }] of byPerson) {
    const evidence: EvidenceRow[] = events.map((e) => {
      const baseWeight = EVENT_WEIGHTS[e.type] ?? 0.1
      const weight = parseFloat((baseWeight * recencyWeight(e.ts)).toFixed(4))
      return { event_id: e.event_id, type: e.type, subject_id: e.subject_id, ts: e.ts, client_specific: e.client_id !== null, weight }
    })

    const score = parseFloat(Math.min(evidence.reduce((sum, e) => sum + e.weight, 0), 1).toFixed(4))
    const last_active = events.length > 0 ? events[0].ts : null

    results.push({ person_id, name, team_id, score, evidence, last_active, bus_factor_risk: false })
  }

  results.sort((a, b) => b.score - a.score)

  if (busFactorRisk(results)) results.forEach((r) => { r.bus_factor_risk = true })

  return results
}

// Fewer than two people have evidence specific to this client (also true when nobody has).
export function busFactorRisk(experts: ExpertResult[]): boolean {
  return experts.filter((r) => r.evidence.some((e) => e.client_specific)).length < 2
}
