import type { Expert } from '../types'

const EVENT_LABELS: Record<string, string> = {
  ruling_made: 'Made a ruling',
  source_approved: 'Approved',
  source_edited: 'Edited',
  source_created: 'Wrote',
  question_answered: 'Answered a question',
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function ExpertList({ experts }: { experts: Expert[] }) {
  if (experts.length === 0) return <p className="empty">Nobody has evidence of working on this for this client.</p>
  return (
    <ol className="experts">
      {experts.map((e) => (
        <li key={e.person_id} className="expert">
          <div className="expert-head">
            <span className="expert-name">{e.name}</span>
            <span className="score" title="Evidence score, recent work counts more">
              <span className="score-bar" style={{ width: `${Math.round(e.score * 100)}%` }} />
            </span>
            <span className="score-value">{e.score.toFixed(2)}</span>
          </div>
          <details>
            <summary>
              {e.evidence.length} evidence {e.evidence.length === 1 ? 'row' : 'rows'}
              {e.last_active && `, last active ${formatDate(e.last_active)}`}
            </summary>
            <table className="evidence">
              <tbody>
                {e.evidence.map((row) => (
                  <tr key={row.event_id}>
                    <td>{formatDate(row.ts)}</td>
                    <td>{EVENT_LABELS[row.type] ?? row.type}</td>
                    <td>
                      {row.subject_id.startsWith('doc-') ? (
                        <a href={`#/provenance/${row.subject_id.split('@')[0]}`}>{row.subject_id}</a>
                      ) : (
                        row.subject_id
                      )}
                    </td>
                    <td className="muted">{row.client_specific ? 'this client' : 'generic'}</td>
                    <td className="num">+{row.weight.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </li>
      ))}
    </ol>
  )
}
