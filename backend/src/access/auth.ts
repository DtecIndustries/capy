import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { sql } from '../db/client.js'

const SECRET = new TextEncoder().encode(
  process.env.CAPY_JWT_SECRET ?? 'dev-secret-change-in-production'
)

export interface CallerIdentity {
  person_id: string
  name: string
  team_id: string
  client_ids: string[]
}

interface CapyPayload extends JWTPayload {
  person_id: string
  name: string
  team_id: string
  client_ids: string[]
}

export async function signToken(identity: CallerIdentity): Promise<string> {
  return new SignJWT({ ...identity })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<CallerIdentity> {
  const { payload } = await jwtVerify<CapyPayload>(token, SECRET)
  // Merge DB bindings so tokens stay valid after seed changes
  const rows = await sql<{ client_id: string }[]>`
    SELECT client_id FROM client_binding WHERE person_id = ${payload.person_id}
  `
  const dbIds = rows.map(r => r.client_id)
  const merged = [...new Set([...payload.client_ids, ...dbIds])]
  return {
    person_id: payload.person_id,
    name: payload.name,
    team_id: payload.team_id,
    client_ids: merged,
  }
}
