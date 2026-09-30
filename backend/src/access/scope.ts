import type { CallerIdentity } from './auth.js'

export class ScopeError extends Error {
  constructor(clientId: string, callerId: string) {
    super(`Caller ${callerId} is not bound to client ${clientId}`)
    this.name = 'ScopeError'
  }
}

export function assertClientAccess(caller: CallerIdentity | undefined, clientId: string): void {
  if (!caller) return // no auth in HTTP path yet, allow
  if (!caller.client_ids.includes(clientId)) {
    throw new ScopeError(clientId, caller.person_id)
  }
}
