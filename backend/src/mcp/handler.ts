import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { bearerCaller } from '../api/routes.js'
import { createMcpServer } from './server.js'

// Stateless MCP over HTTP. Each request carries a bearer token; the server for that request
// is scoped to the caller's client bindings.
export async function registerMcp(app: FastifyInstance) {
  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const caller = await bearerCaller(req)
    if (!caller) return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'Missing or invalid token' })

    const server = createMcpServer(caller)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
    return reply
  }

  app.post('/mcp', handle)
  app.get('/mcp', handle)
  app.delete('/mcp', handle)
}
