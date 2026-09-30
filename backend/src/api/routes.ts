import type { FastifyInstance, FastifyRequest } from 'fastify'
import { sql } from '../db/client.js'
import { signToken, verifyToken, type CallerIdentity } from '../access/auth.js'
import { assertClientAccess, canSeeDocument, ScopeError } from '../access/scope.js'
import { getHealth } from '../engines/health.js'
import { lookup } from '../engines/lookup.js'
import { getProvenance } from '../engines/provenance.js'

// REST API for the web UI. Every route needs a bearer token; the caller's identity and
// client bindings come from that token only.

declare module 'fastify' {
  interface FastifyRequest {
    caller: CallerIdentity
  }
}

export async function bearerCaller(req: FastifyRequest): Promise<CallerIdentity | undefined> {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
  return match ? verifyToken(match[1]).catch(() => undefined) : undefined
}

export async function registerApi(app: FastifyInstance) {
  // Dev only: lists the seeded people with ready-made tokens, for the persona switcher.
  if (process.env.CAPY_DEV_PERSONAS === 'true') {
    app.get('/api/dev/personas', async () => {
      const people = await sql<{ id: string; name: string; team_id: string; team_name: string; client_ids: string[] }[]>`
        SELECT p.id, p.name, p.team_id, t.name AS team_name,
               COALESCE(array_agg(cb.client_id ORDER BY cb.client_id) FILTER (WHERE cb.client_id IS NOT NULL), '{}') AS client_ids
        FROM person p JOIN team t ON t.id = p.team_id
        LEFT JOIN client_binding cb ON cb.person_id = p.id
        WHERE p.status = 'active'
        GROUP BY p.id, t.name ORDER BY t.name, p.name
      `
      return Promise.all(
        people.map(async (p) => ({
          ...p,
          token: await signToken({ person_id: p.id, name: p.name, team_id: p.team_id, client_ids: p.client_ids }),
        })),
      )
    })
  }

  app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      const caller = await bearerCaller(req)
      if (!caller) return reply.code(401).send({ error: 'Missing or invalid token' })
      req.caller = caller
    })

    api.setErrorHandler((err, req, reply) => {
      if (err instanceof ScopeError) return reply.code(403).send({ error: err.message })
      req.log.error(err)
      return reply.code(500).send({ error: 'Internal error' })
    })

    api.get('/api/me', async (req) => req.caller)

    // The pickers: apps and domains, and only the clients this caller is bound to.
    api.get('/api/taxonomy', async (req) => {
      const [apps, domains, clients] = await Promise.all([
        sql`SELECT id, name FROM app ORDER BY name`,
        sql`SELECT d.id, d.app_id, d.name, d.owner_team_id, t.name AS owner_team_name
            FROM domain d JOIN team t ON t.id = d.owner_team_id ORDER BY d.name`,
        sql`SELECT id, name, country FROM client WHERE id = ANY(${req.caller.client_ids}) ORDER BY name`,
      ])
      return { apps, domains, clients }
    })

    api.get<{ Querystring: { app: string; domain: string; client: string } }>(
      '/api/lookup',
      {
        schema: {
          querystring: {
            type: 'object',
            required: ['app', 'domain', 'client'],
            properties: { app: { type: 'string' }, domain: { type: 'string' }, client: { type: 'string' } },
          },
        },
      },
      async (req) => {
        assertClientAccess(req.caller, req.query.client)
        return lookup(req.query)
      },
    )

    api.get<{ Params: { id: string } }>('/api/documents/:id/provenance', async (req, reply) => {
      if (!(await canSeeDocument(req.caller, req.params.id))) return reply.code(404).send({ error: 'Not found' })
      return getProvenance(req.params.id)
    })

    // The health board: every domain of an app, with only findings the caller may see.
    api.get<{ Querystring: { app: string } }>('/api/health', async (req) => {
      const domains = await sql<{ id: string; name: string; owner_team_name: string }[]>`
        SELECT d.id, d.name, t.name AS owner_team_name FROM domain d JOIN team t ON t.id = d.owner_team_id
        WHERE d.app_id = ${req.query.app} ORDER BY d.name
      `
      return Promise.all(
        domains.map(async (d) => {
          const health = await getHealth(req.query.app, d.id)
          const visible = []
          for (const f of health.findings) {
            const isDocument = /^doc-/.test(f.subject_id)
            if (!isDocument || (await canSeeDocument(req.caller, f.subject_id.split('@')[0]))) visible.push(f)
          }
          return { domain: d, findings: visible }
        }),
      )
    })
  })
}
