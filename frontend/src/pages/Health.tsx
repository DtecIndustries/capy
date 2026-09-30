import { useEffect, useState } from 'react'
import { api } from '../api'
import { Capybara, type Mood } from '../components/Capybara'
import type { DomainHealth, Finding, Taxonomy } from '../types'

const KINDS: Record<Finding['kind'], { label: string; mood: Mood }> = {
  conflict: { label: 'Contradiction', mood: 'sweating' },
  orphaned: { label: 'Orphaned', mood: 'asleep' },
  stale: { label: 'Stale', mood: 'asleep' },
  duplicate: { label: 'Duplicate', mood: 'eyebrow' },
  never_reviewed: { label: 'Never reviewed', mood: 'eyebrow' },
  gap: { label: 'No trusted document', mood: 'phone' },
  bus_factor: { label: 'Bus-factor risk', mood: 'phone' },
}

// The domain's overall mood: its most serious finding, or relaxed.
function domainMood(findings: Finding[]): Mood {
  const order: Finding['kind'][] = ['conflict', 'gap', 'orphaned', 'stale', 'bus_factor', 'duplicate', 'never_reviewed']
  const worst = order.find((k) => findings.some((f) => f.kind === k))
  return worst ? KINDS[worst].mood : 'relaxed'
}

export function Health({ taxonomy }: { taxonomy: Taxonomy }) {
  const [app, setApp] = useState(taxonomy.apps.find((a) => a.id === 'pay')?.id ?? taxonomy.apps[0]?.id ?? '')
  const [board, setBoard] = useState<DomainHealth[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBoard(null)
    api.health(app).then(setBoard).catch((e: Error) => setError(e.message))
  }, [app])

  return (
    <section>
      <div className="tabs" role="tablist">
        {taxonomy.apps.map((a) => (
          <button key={a.id} role="tab" aria-selected={a.id === app} className={a.id === app ? 'active' : ''} onClick={() => setApp(a.id)}>
            {a.name}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!board && !error && <p className="muted">Loading…</p>}
      <div className="board">
        {board?.map(({ domain, findings }) => (
          <article key={domain.id} className="card">
            <header>
              <Capybara mood={domainMood(findings)} size={44} />
              <div>
                <h3>{domain.name}</h3>
                <span className="muted">{domain.owner_team_name}</span>
              </div>
            </header>
            {findings.length === 0 ? (
              <p className="muted">Nothing to clean up.</p>
            ) : (
              <ul className="findings">
                {findings.map((f, i) => (
                  <li key={`${f.kind}-${f.subject_id}-${i}`}>
                    <span className={`kind kind-${f.kind}`}>{KINDS[f.kind].label}</span>
                    <span>{f.description}</span>
                    <span className="muted">→ {f.suggested_action}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
