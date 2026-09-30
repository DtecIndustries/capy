import { useEffect, useState } from 'react'
import { api } from '../api'
import type { LedgerEvent } from '../types'

const EVENT_COLORS: Record<string, string> = {
  source_created: '#4ade80',
  source_edited: '#60a5fa',
  source_approved: '#a78bfa',
  source_superseded: '#f87171',
  owner_changed: '#fb923c',
  question_answered: '#34d399',
  conflict_detected: '#f43f5e',
  ruling_made: '#e879f9',
  task_confirmed: '#94a3b8',
  person_left: '#ef4444',
}

function EventBadge({ type }: { type: string }) {
  const color = EVENT_COLORS[type] ?? '#94a3b8'
  return (
    <span style={{
      background: color + '22',
      color,
      border: `1px solid ${color}55`,
      borderRadius: 4,
      padding: '1px 7px',
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      {type}
    </span>
  )
}

function PayloadCell({ payload }: { payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const keys = Object.keys(payload)
  if (keys.length === 0) return <span style={{ color: '#64748b' }}>—</span>
  return (
    <span>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#60a5fa', fontSize: 12, padding: 0 }}
        >
          {keys.slice(0, 3).join(', ')}{keys.length > 3 ? '…' : ''}
        </button>
      )}
      {open && (
        <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxWidth: 320 }}>
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </span>
  )
}

export function Ledger() {
  const [events, setEvents] = useState<LedgerEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    api.ledger(200).then(setEvents).finally(() => setLoading(false))
  }, [])

  const filtered = filter
    ? events.filter(e =>
        e.event_type.includes(filter) ||
        e.subject_id.includes(filter) ||
        (e.actor_name ?? '').toLowerCase().includes(filter.toLowerCase())
      )
    : events

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Ledger ({events.length} events)</h2>
        <input
          placeholder="Filter by type, subject or actor…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 320, padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13 }}
        />
      </div>

      {loading && <p>Loading…</p>}

      {!loading && filtered.length === 0 && (
        <p style={{ color: '#64748b' }}>No events{filter ? ' matching filter' : ''}.</p>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b', textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '6px 10px', width: 60 }}>#</th>
                <th style={{ padding: '6px 10px' }}>Type</th>
                <th style={{ padding: '6px 10px' }}>Subject</th>
                <th style={{ padding: '6px 10px' }}>Actor</th>
                <th style={{ padding: '6px 10px' }}>Payload</th>
                <th style={{ padding: '6px 10px', width: 160 }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.seq} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '6px 10px', color: '#475569', fontFamily: 'monospace' }}>{e.seq}</td>
                  <td style={{ padding: '6px 10px' }}><EventBadge type={e.event_type} /></td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>{e.subject_id}</td>
                  <td style={{ padding: '6px 10px', color: '#cbd5e1' }}>{e.actor_name ?? <span style={{ color: '#475569' }}>—</span>}</td>
                  <td style={{ padding: '6px 10px' }}><PayloadCell payload={e.payload} /></td>
                  <td style={{ padding: '6px 10px', color: '#64748b', fontSize: 12 }}>{new Date(e.recorded_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
