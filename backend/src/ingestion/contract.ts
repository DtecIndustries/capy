// The normalized change event every connector emits (docs/ARCHITECTURE.md, "connector contract").
// Connectors keep their source-specific tables up to date themselves; these events are what
// ends up in the ledger.

export type SourceType = 'sharepoint' | 'mail' | 'directory'

export type ChangeAction =
  | 'created'
  | 'edited'
  | 'approved'
  | 'owner_changed'
  | 'replied'
  | 'person_left'

export interface ChangeEvent {
  source_type: SourceType
  // Document, mail or person id in our own namespace.
  source_id: string
  action: ChangeAction
  // Person id of whoever did it.
  actor: string
  // When it happened in the source system (not when we ingested it).
  timestamp: string
  content_hash?: string
  location?: string
  pointer?: string
  // Versioned reference, e.g. "doc-014@2.0".
  raw_ref?: string
  country?: string | null
  details?: Record<string, unknown>
}
