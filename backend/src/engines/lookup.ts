import { sql } from '../db/client.js'
import { busFactorRisk, getExperts } from './expertise.js'
import { getTrustedDocs } from './trust.js'
import type { TrustContext } from './trust.types.js'

export interface RouteTo {
  team: { id: string; name: string }
  people: { id: string; name: string; reason: string }[]
}

// The two questions for one context, answered together. When no document can be trusted,
// the answer is a route to the owning team instead of the least-bad document.
export async function lookup(ctx: TrustContext) {
  const [documents, experts] = await Promise.all([getTrustedDocs(ctx), getExperts(ctx)])
  const trusted = documents.filter((d) => !d.excluded)
  const excluded = documents.filter((d) => d.excluded)
  const nothingTrusted = !trusted.some((d) => d.verdict === 'trusted')
  return {
    context: ctx,
    trusted,
    excluded,
    experts,
    bus_factor_risk: busFactorRisk(experts),
    route_to: nothingTrusted ? await routeTo(ctx, experts) : null,
  }
}

async function routeTo(ctx: TrustContext, experts: Awaited<ReturnType<typeof getExperts>>): Promise<RouteTo | null> {
  const [team] = await sql<{ id: string; name: string }[]>`
    SELECT t.id, t.name FROM domain d JOIN team t ON t.id = d.owner_team_id WHERE d.id = ${ctx.domain}
  `
  if (!team) return null
  const inTeam = experts.filter((e) => e.team_id === team.id).slice(0, 2)
  if (inTeam.length > 0) {
    return { team, people: inTeam.map((e) => ({ id: e.person_id, name: e.name, reason: `Most evidence in this domain for this client (score ${e.score})` })) }
  }
  const members = await sql<{ id: string; name: string }[]>`
    SELECT p.id, p.name FROM person p
    JOIN client_binding cb ON cb.person_id = p.id AND cb.client_id = ${ctx.client}
    WHERE p.team_id = ${team.id} AND p.status = 'active' ORDER BY p.name LIMIT 2
  `
  return { team, people: members.map((m) => ({ ...m, reason: 'Member of the owning team, bound to this client' })) }
}
