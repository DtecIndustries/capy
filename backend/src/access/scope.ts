import { sql } from '../db/client.js'
import type { CallerIdentity } from './auth.js'

// Every query is filtered by the caller's client bindings (from the token, never from a
// parameter). A document is visible when it is generic or tagged for one of those clients.

export class ScopeError extends Error {
  constructor(clientId: string, callerId: string) {
    super(`Caller ${callerId} is not bound to client ${clientId}`)
    this.name = 'ScopeError'
  }
}

export function assertClientAccess(caller: CallerIdentity, clientId: string): void {
  if (!caller.client_ids.includes(clientId)) {
    throw new ScopeError(clientId, caller.person_id)
  }
}

export async function canSeeDocument(caller: CallerIdentity, documentId: string): Promise<boolean> {
  const areas = await sql<{ client_id: string | null }[]>`
    SELECT DISTINCT da.client_id FROM document_area da
    JOIN document_version dv ON dv.id = da.document_version_id
    WHERE dv.document_id = ${documentId}
  `
  return areas.some((a) => a.client_id === null || caller.client_ids.includes(a.client_id))
}
