export type Verdict = 'trusted' | 'stale' | 'unowned' | 'scope_mismatch' | 'conflict'
export type ScopeMatch = 'client-specific' | 'generic' | 'wrong-client' | 'wrong-country'
export type Freshness = 'latest' | 'superseded'

export interface TrustSignals {
  freshness: Freshness
  approved_by_owner_team: boolean
  owner_active: boolean
  scope_match: ScopeMatch
  consistent_with_siblings: boolean
}

export interface TrustResult {
  document_id: string
  document_version_id: string
  title: string
  version: string
  rank: number
  verdict: Verdict
  signals: TrustSignals
  reasons: string[]
  excluded: boolean
}

export interface TrustContext {
  app: string
  domain: string
  client: string
}
