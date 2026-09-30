export interface EvidenceRow {
  event_id: string
  type: string
  ts: Date
  weight: number
}

export interface ExpertResult {
  person_id: string
  name: string
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
