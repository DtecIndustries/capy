export type EventType =
  | 'source_created'
  | 'source_edited'
  | 'source_approved'
  | 'source_superseded'
  | 'question_answered'
  | 'conflict_detected'
  | 'ruling_made'
  | 'task_confirmed'
  | 'person_left'

export type SubjectType = 'document' | 'mail' | 'person' | 'housekeeping_task'

export interface EventInput {
  actor_id: string
  type: EventType
  subject_type: SubjectType
  subject_id: string
  domain_id?: string
  client_id?: string
  country?: string
  payload?: Record<string, unknown>
}

export interface LedgerEvent extends EventInput {
  id: string
  ts: Date
  prev_hash: string | null
  hash: string
}
