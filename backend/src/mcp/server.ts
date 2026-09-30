import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getTrustedDocs } from '../engines/trust.js'
import { getExperts } from '../engines/expertise.js'
import { getProvenance } from '../engines/provenance.js'
import { getHealth } from '../engines/health.js'

export function createMcpServer(): McpServer {
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

  return server
}
