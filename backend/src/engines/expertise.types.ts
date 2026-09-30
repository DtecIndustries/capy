export interface EvidenceRow {
  event_id: string
  type: string
  subject_id: string
  // When it happened in the source system.
  ts: Date
  client_specific: boolean
  weight: number
}

export interface ExpertResult {
  person_id: string
  name: string
  team_id: string
  score: number
  evidence: EvidenceRow[]
  last_active: Date | null
  bus_factor_risk: boolean
}

export interface ExpertiseContext {
  app: string
  domain: string
  client: string
}
