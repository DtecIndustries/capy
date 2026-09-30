import type { FastifyInstance } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './server.js'

export async function registerMcp(app: FastifyInstance) {
  const mcpServer = createMcpServer()

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  })

  await mcpServer.connect(transport)

  app.post('/mcp', async (req, reply) => {
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })

  app.get('/mcp', async (req, reply) => {
    await transport.handleRequest(req.raw, reply.raw)
  })

  app.delete('/mcp', async (req, reply) => {
    await transport.handleRequest(req.raw, reply.raw)
  })
}
