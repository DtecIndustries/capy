import Fastify from 'fastify'
import { migrate } from './db/migrate.js'
import { registerMcp } from './mcp/handler.js'

const app = Fastify({ logger: true })

app.get('/health', async () => {
  return { status: 'ok' }
})

const port = Number(process.env.PORT ?? 3737)

try {
  await migrate()
  await registerMcp(app)
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
