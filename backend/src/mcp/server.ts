import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getTrustedDocs } from '../engines/trust.js'
import { getExperts } from '../engines/expertise.js'
import { getProvenance } from '../engines/provenance.js'
import { getHealth } from '../engines/health.js'
import type { CallerIdentity } from '../access/auth.js'
import { routeQuery } from '../engines/router.js'
import { assertClientAccess, ScopeError } from '../access/scope.js'

function scopeErrorResponse(err: ScopeError) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: 'access_denied', message: err.message }, null, 2),
    }],
  }
}

export function createMcpServer(caller?: CallerIdentity): McpServer {
  const server = new McpServer({
    name: 'capy-ledger',
    version: '0.1.0',
  })

  server.tool(
    'trusted_docs',
    'Returns ranked trustworthy documents for a given app, domain and client, with reasons. Excluded documents are included with their exclusion reason.',
    {
      app: z.string().describe('Application id, e.g. "pay", "hr", "time"'),
      domain: z.string().describe('Domain id, e.g. "pay.sick-leave"'),
      client: z.string().describe('Client id, e.g. "client-x"'),
    },
    async ({ app, domain, client }) => {
      try { assertClientAccess(caller, client) } catch (e) { return scopeErrorResponse(e as ScopeError) }
      const results = await getTrustedDocs({ app, domain, client })
      const trusted = results.filter(r => !r.excluded)
      const excluded = results.filter(r => r.excluded)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ context: { app, domain, client }, trusted, excluded }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'who_knows',
    'Returns people ranked by expertise for a given app, domain and client, each with their evidence rows. Flags bus-factor risk when fewer than two people have evidence.',
    {
      app: z.string().describe('Application id'),
      domain: z.string().describe('Domain id'),
      client: z.string().describe('Client id'),
    },
    async ({ app, domain, client }) => {
      try { assertClientAccess(caller, client) } catch (e) { return scopeErrorResponse(e as ScopeError) }
      const experts = await getExperts({ app, domain, client })
      const bus_factor_risk = experts.some(e => e.bus_factor_risk)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ context: { app, domain, client }, experts, bus_factor_risk }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'get_provenance',
    'Returns the full ledger history for a document: every event (created, edited, approved, superseded…) with actor, timestamp and payload.',
    {
      document_id: z.string().describe('Document id, e.g. "doc-014"'),
    },
    async ({ document_id }) => {
      const result = await getProvenance(document_id)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      }
    }
  )

  server.tool(
    'health',
    'Returns housekeeping findings for an app and domain: orphaned documents, stale versions, unreviewed content, duplicates, contradictions, gaps and bus-factor risks.',
    {
      app: z.string().describe('Application id'),
      domain: z.string().describe('Domain id'),
    },
    async ({ app, domain }) => {
      const result = await getHealth(app, domain)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      }
    }
  )

  server.tool(
    'lookup',
    'The main entry point. Given a free-text description of a customer question or situation, returns the top experts and top documents for that context, each with a relevance percentage. Use this before trying the other tools.',
    {
      query: z.string().describe(
        'Free-text description, e.g. "customer Scheldemond called about sick leave in the Pay app"'
      ),
    },
    async ({ query }) => {
      const route = routeQuery(query)

      if (!route.domain_id && !route.app) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Could not determine app or domain from query. Try mentioning the app (pay, hr, time) and topic (sick leave, year-end, contracts…).',
              query,
            }, null, 2),
          }],
        }
      }

      const client = route.client_id ?? caller?.client_ids[0]

      if (!client) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Could not determine client from query and no default client in token.',
              query,
            }, null, 2),
          }],
        }
      }

      const domainId = route.domain_id ?? `${route.app}.*`

      const [expertResults, docResults] = await Promise.all([
        route.domain_id ? getExperts({ app: route.app!, domain: route.domain_id, client }) : Promise.resolve([]),
        route.domain_id ? getTrustedDocs({ app: route.app!, domain: route.domain_id, client }) : Promise.resolve([]),
      ])

      const experts = expertResults.slice(0, 3).map(e => ({
        person_id: e.person_id,
        name: e.name,
        relevance_pct: Math.round(e.score * 100),
        bus_factor_risk: e.bus_factor_risk,
      }))

      const documents = docResults.slice(0, 5).map(d => ({
        document_id: d.document_id,
        title: d.title,
        verdict: d.verdict,
        relevance_pct: d.signals.scope_match === 'client-specific' ? 90
          : d.signals.scope_match === 'generic' ? 70
          : 40,
        reasons: d.reasons,
      }))

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            query,
            resolved: { app: route.app, domain: domainId, client },
            experts,
            documents,
          }, null, 2),
        }],
      }
    }
  )

  return server
}
