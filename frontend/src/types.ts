// Shapes returned by the backend API (backend/src/api/routes.ts).

export type Verdict = 'trusted' | 'unverified' | 'stale' | 'unowned' | 'scope_mismatch' | 'conflict'

export interface Persona {
  id: string
  name: string
  team_id: string
  team_name: string
  client_ids: string[]
  token: string
}

export interface Taxonomy {
  apps: { id: string; name: string }[]
  domains: { id: string; app_id: string; name: string; owner_team_id: string; owner_team_name: string }[]
  clients: { id: string; name: string; country: string }[]
}

export interface Conflict {
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
  signals: {
    freshness: 'latest' | 'superseded'
    approved_by_owner_team: boolean
    owner_active: boolean
    scope_match: string
    consistent_with_siblings: boolean
    copy_of: string | null
  }
  reasons: string[]
  excluded: boolean
  owner: { id: string; name: string; status: string } | null
  conflicts: Conflict[]
}

export interface Evidence {
  event_id: string
  type: string
  subject_id: string
  ts: string
  client_specific: boolean
  weight: number
}

export interface Expert {
  person_id: string
  name: string
  team_id: string
  score: number
  evidence: Evidence[]
  last_active: string | null
}

export interface LookupResult {
  context: { app: string; domain: string; client: string }
  trusted: TrustResult[]
  excluded: TrustResult[]
  experts: Expert[]
  bus_factor_risk: boolean
  route_to: { team: { id: string; name: string }; people: { id: string; name: string; reason: string }[] } | null
}

export interface ProvenanceEvent {
  event_id: string
  ts: string
  recorded_at: string
  type: string
  subject_id: string
  actor_id: string
  actor_name: string | null
  payload: Record<string, unknown>
  hash: string
}

export interface Provenance {
  document_id: string
  title: string | null
  current_version_id: string | null
  owner: { id: string; name: string; status: string } | null
  events: ProvenanceEvent[]
}

export interface Finding {
  kind: 'orphaned' | 'stale' | 'never_reviewed' | 'duplicate' | 'conflict' | 'gap' | 'bus_factor'
  subject_id: string
  description: string
  suggested_action: string
}

export interface DomainHealth {
  domain: { id: string; name: string; owner_team_name: string }
  findings: Finding[]
}
