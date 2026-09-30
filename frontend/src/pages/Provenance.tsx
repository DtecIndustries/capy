import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Provenance as ProvenanceData, ProvenanceEvent } from '../types'

const LABELS: Record<string, string> = {
  source_created: 'Created',
  source_edited: 'New version',
  source_superseded: 'Superseded',
  source_approved: 'Approved',
  owner_changed: 'Owner changed',
  question_answered: 'Linked in a mail',
  conflict_detected: 'Conflict detected',
  ruling_made: 'Ruling',
  person_left: 'Person left',
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function describe(e: ProvenanceEvent): string {
  const p = e.payload
  switch (e.type) {
    case 'source_edited':
      return `${p.from_version} → ${p.to_version}`
    case 'owner_changed':
      return `${p.from ?? 'nobody'} → ${p.to ?? 'nobody'}`
    case 'question_answered':
      return `${e.subject_id} in thread ${p.thread_id}`
    case 'conflict_detected':
      return `${e.subject_id} vs ${p.with}: ${p.question}`
    default:
      return e.subject_id
  }
}

export function Provenance({ documentId }: { documentId: string }) {
  const [data, setData] = useState<ProvenanceData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    api.provenance(documentId).then(setData).catch((e: Error) => setError(e.message))
  }, [documentId])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  return (
    <section className="provenance">
      <a href="#/" className="back">← Back to lookup</a>
      <h2>{data.title ?? documentId}</h2>
      <p className="muted">
        {documentId} · current version {data.current_version_id ?? '—'} · owner{' '}
        {data.owner ? `${data.owner.name}${data.owner.status === 'left' ? ' (has left)' : ''}` : 'none'}
      </p>
      <ol className="timeline">
        {data.events.map((e) => (
          <li key={e.event_id} className={`event event-${e.type}`}>
            <time>{formatDate(e.ts)}</time>
            <div>
              <strong>{LABELS[e.type] ?? e.type}</strong> {describe(e)}
              <div className="muted">
                by {e.actor_name ?? e.actor_id} · ledger hash <code>{e.hash.slice(0, 12)}</code>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
