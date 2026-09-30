import { sql } from '../db/client.js'
import type { ExpertiseContext, ExpertResult, EvidenceRow } from './expertise.types.js'

// How much each event type contributes before recency decay
const EVENT_WEIGHTS: Record<string, number> = {
  ruling_made:      1.0,
  source_approved:  0.7,
  source_edited:    0.4,
  question_answered: 0.2,
  source_created:   0.3,
}

const DECAY_HALF_LIFE_DAYS = 180

function recencyWeight(ts: Date): number {
  const ageMs = Date.now() - ts.getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS)
}

interface EventRow {
  event_id: string
  actor_id: string
  person_name: string
  type: string
  ts: Date
}

export async function getExperts(ctx: ExpertiseContext): Promise<ExpertResult[]> {
  // Events in this domain scoped to this client, by people still bound to this client
  const rows = await sql<EventRow[]>`
    SELECT
      e.id   AS event_id,
      e.actor_id,
      p.name AS person_name,
      e.type,
      e.ts
    FROM event e
    JOIN person p ON p.id = e.actor_id
    JOIN client_binding cb ON cb.person_id = p.id AND cb.client_id = ${ctx.client}
    WHERE e.domain_id = ${ctx.domain}
      AND (e.client_id IS NULL OR e.client_id = ${ctx.client})
      AND e.type = ANY(${Object.keys(EVENT_WEIGHTS)}::text[])
    ORDER BY e.actor_id, e.ts DESC
  `

  // Group by person
  const byPerson = new Map<string, { name: string; events: EventRow[] }>()
  for (const row of rows) {
    if (!byPerson.has(row.actor_id)) {
      byPerson.set(row.actor_id, { name: row.person_name, events: [] })
    }
    byPerson.get(row.actor_id)!.events.push(row)
  }

  const results: ExpertResult[] = []

  for (const [person_id, { name, events }] of byPerson) {
    const evidence: EvidenceRow[] = events.map(e => {
      const baseWeight = EVENT_WEIGHTS[e.type] ?? 0.1
      const weight = parseFloat((baseWeight * recencyWeight(e.ts)).toFixed(4))
      return { event_id: e.event_id, type: e.type, ts: e.ts, weight }
    })

    const score = parseFloat(
      Math.min(evidence.reduce((sum, e) => sum + e.weight, 0), 1).toFixed(4)
    )

    const last_active = events.length > 0 ? events[0].ts : null

    results.push({ person_id, name, score, evidence, last_active, bus_factor_risk: false })
  }

  results.sort((a, b) => b.score - a.score)

  // Flag bus-factor risk when fewer than 2 people have meaningful evidence
  const meaningful = results.filter(r => r.score > 0.1)
  if (meaningful.length < 2) {
    results.forEach(r => { r.bus_factor_risk = true })
  }

  return results
}
