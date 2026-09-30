import type { DomainHealth, LedgerEvent, LookupResult, Persona, Provenance, Taxonomy } from './types'

const TOKEN_KEY = 'capy.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Private mode: the persona just isn't remembered.
  }
}

async function get<T>(path: string, token: string | null = getToken()): Promise<T> {
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  personas: () => get<Persona[]>('/api/dev/personas', null),
  taxonomy: () => get<Taxonomy>('/api/taxonomy'),
  lookup: (app: string, domain: string, client: string) =>
    get<LookupResult>(`/api/lookup?${new URLSearchParams({ app, domain, client })}`),
  provenance: (documentId: string) => get<Provenance>(`/api/documents/${encodeURIComponent(documentId)}/provenance`),
  health: (app: string) => get<DomainHealth[]>(`/api/health?${new URLSearchParams({ app })}`),
  ledger: (limit = 200) => get<LedgerEvent[]>(`/api/dev/ledger?limit=${limit}`, null),
}
