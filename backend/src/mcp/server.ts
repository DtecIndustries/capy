import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { lookup } from '../engines/lookup.js'
import { getExperts } from '../engines/expertise.js'
import { getTrustedDocs } from '../engines/trust.js'
import { getProvenance } from '../engines/provenance.js'
import { getHealth } from '../engines/health.js'
import { assertClientAccess, canSeeDocument, ScopeError } from '../access/scope.js'
import type { CallerIdentity } from '../access/auth.js'
import { routeQuery } from '../engines/router.js'

function scopeErrorResponse(err: ScopeError) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: 'access_denied', message: err.message }, null, 2),
    }],
  }
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
const denied = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

// The caller comes from the transport's token, never from a tool argument; every tool is
// limited to the caller's client bindings.
export function createMcpServer(caller: CallerIdentity): McpServer {
  const server = new McpServer({
    name: 'capy-ledger',
    version: '0.1.0',
  })

  server.tool(
    'trusted_docs',
    'Returns ranked trustworthy documents for a given app, domain and client, with reasons. Excluded documents are included with their exclusion reason. When nothing can be trusted, route_to names who to ask instead.',
    {
      app: z.string().describe('Application id, e.g. "pay", "hr", "time"'),
      domain: z.string().describe('Domain id, e.g. "pay.sick-leave"'),
      client: z.string().describe('Client id, e.g. "client-x"'),
    },
    async ({ app, domain, client }) => {
      try { assertClientAccess(caller, client) } catch (e) { return scopeErrorResponse(e as ScopeError) }
      const { context, trusted, excluded, route_to } = await lookup({ app, domain, client })
      return json({ context, trusted, excluded, route_to })
    }
  )

  server.tool(
    'who_knows',
    'Returns people ranked by expertise for a given app, domain and client, each with their evidence rows. Flags bus-factor risk when fewer than two people have client-specific evidence.',
    {
      app: z.string().describe('Application id'),
      domain: z.string().describe('Domain id'),
      client: z.string().describe('Client id'),
    },
    async ({ app, domain, client }) => {
      try { assertClientAccess(caller, client) } catch (e) { return scopeErrorResponse(e as ScopeError) }
      const { context, experts, bus_factor_risk } = await lookup({ app, domain, client })
      return json({ context, experts, bus_factor_risk })
    }
  )

  server.tool(
    'get_provenance',
    'Returns the full ledger history for a document: every event (created, edited, approved, superseded, conflicts, mails that link to it) with actor, time and payload.',
    {
      document_id: z.string().describe('Document id, e.g. "doc-014"'),
    },
    async ({ document_id }) => {
      if (!(await canSeeDocument(caller, document_id))) return denied(`Document '${document_id}' not found.`)
      return json(await getProvenance(document_id))
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
      const findings = []
      for (const f of result.findings) {
        if (!/^doc-/.test(f.subject_id) || (await canSeeDocument(caller, f.subject_id.split('@')[0]))) findings.push(f)
      }
      return json({ ...result, findings })
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

      // A client named in the query must still be one the caller is bound to.
      try { assertClientAccess(caller, client) } catch (e) { return scopeErrorResponse(e as ScopeError) }

      const domainId = route.domain_id ?? `${route.app}.*`

      const [expertResults, docResults] = await Promise.all([
        route.domain_id ? getExperts({ app: route.app!, domain: route.domain_id, client }) : Promise.resolve([]),
        route.domain_id ? getTrustedDocs({ app: route.app!, domain: route.domain_id, client }) : Promise.resolve([]),
      ])

      const experts = expertResults.slice(0, 3).map(e => ({
        name: e.name,
        pct: Math.round(e.score * 100),
        bus_factor_risk: e.bus_factor_risk,
      }))

      const documents = docResults.slice(0, 5).map(d => ({
        title: d.title,
        verdict: d.verdict,
        pct: d.signals.scope_match === 'client-specific' ? 90
          : d.signals.scope_match === 'generic' ? 70
          : 40,
        reason: d.reasons[0] ?? '',
      }))

      const verdictEmoji: Record<string, string> = {
        trusted: '✅', unverified: '🤨', conflict: '⚠️', unowned: '👻', stale: '🕸️', scope_mismatch: '🌍',
      }

      const expertLines = experts.length > 0
        ? experts.map(e =>
            `| ${e.name} | ${e.pct}% |${e.bus_factor_risk ? ' ⚠️ only expert' : ''}`
          ).join('\n')
        : '| — | No experts found |'

      const docLines = documents.length > 0
        ? documents.map(d =>
            `| ${verdictEmoji[d.verdict] ?? '❓'} ${d.title} | ${d.pct}% | ${d.reason} |`
          ).join('\n')
        : '| — | No documents found | |'

      const md = `## Lookup: ${domainId} · ${client}

### 👥 Top experts
| Name | Relevance |
|---|---|
${expertLines}

### 📄 Top documents
| Document | Relevance | Reason |
|---|---|---|
${docLines}
`

      return {
        content: [{
          type: 'text' as const,
          text: md,
        }],
      }
    }
  )

  return server
}
