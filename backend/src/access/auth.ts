import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

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
  return {
    person_id: payload.person_id,
    name: payload.name,
    team_id: payload.team_id,
    client_ids: payload.client_ids,
  }
}
