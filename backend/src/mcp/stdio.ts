import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { verifyToken } from '../access/auth.js'
import { createMcpServer } from './server.js'

const token = process.env.CAPY_TOKEN
if (!token) {
  process.stderr.write('CAPY_TOKEN env var is required\n')
  process.exit(1)
}

const caller = await verifyToken(token).catch(() => {
  process.stderr.write('CAPY_TOKEN is invalid or expired\n')
  process.exit(1)
})

const server = createMcpServer(caller)
const transport = new StdioServerTransport()
await server.connect(transport)
