export type Verdict = 'trusted' | 'unverified' | 'stale' | 'unowned' | 'scope_mismatch' | 'conflict'
export type ScopeMatch = 'client-specific' | 'generic' | 'wrong-client' | 'wrong-country'
export type Freshness = 'latest' | 'superseded'

export interface TrustSignals {
  freshness: Freshness
  approved_by_owner_team: boolean
  owner_active: boolean
  scope_match: ScopeMatch
  consistent_with_siblings: boolean
  // Set when this document is a copy of another document's superseded version.
  copy_of: string | null
}

export interface ConflictInfo {
  with: string
  question: string
  this_says: string
  other_says: string
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
  owner: { id: string; name: string; status: string } | null
  conflicts: ConflictInfo[]
}

export interface TrustContext {
  app: string
  domain: string
  client: string
}
