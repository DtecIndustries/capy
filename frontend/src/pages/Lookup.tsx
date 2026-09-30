import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Capybara } from '../components/Capybara'
import { DocList } from '../components/DocList'
import { ExpertList } from '../components/ExpertList'
import type { LookupResult, Taxonomy } from '../types'

// The lookup: a context (app, domain, client) in, two explained answers out.
export function Lookup({ taxonomy }: { taxonomy: Taxonomy }) {
  const [app, setApp] = useState(taxonomy.apps.find((a) => a.id === 'pay')?.id ?? taxonomy.apps[0]?.id ?? '')
  const domains = useMemo(() => taxonomy.domains.filter((d) => d.app_id === app), [taxonomy, app])
  const [domain, setDomain] = useState(domains[0]?.id ?? '')
  const [client, setClient] = useState(taxonomy.clients[0]?.id ?? '')
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!domains.some((d) => d.id === domain)) setDomain(domains[0]?.id ?? '')
  }, [domains, domain])

  useEffect(() => {
    if (!taxonomy.clients.some((c) => c.id === client)) setClient(taxonomy.clients[0]?.id ?? '')
  }, [taxonomy, client])

  useEffect(() => {
    if (!app || !domain || !client) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .lookup(app, domain, client)
      .then((r) => !cancelled && setResult(r))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [app, domain, client])

  const domainInfo = taxonomy.domains.find((d) => d.id === domain)

  if (taxonomy.clients.length === 0) {
    return <p className="empty">This persona is not bound to any client, so there is nothing to look up.</p>
  }

  return (
    <section>
      <form className="picker" onSubmit={(e) => e.preventDefault()}>
        <label>
          App
          <select value={app} onChange={(e) => setApp(e.target.value)}>
            {taxonomy.apps.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label>
          Domain
          <select value={domain} onChange={(e) => setDomain(e.target.value)}>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label>
          Client
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            {taxonomy.clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.country})</option>
            ))}
          </select>
        </label>
        {domainInfo && <span className="muted owner-note">Owned by {domainInfo.owner_team_name}</span>}
      </form>

      {error && <p className="error">{error}</p>}
      {loading && !result && <p className="muted">Loading…</p>}

      {result && (
        <>
          {result.route_to && (
            <div className="route">
              <Capybara mood="phone" size={56} />
              <div>
                <strong>Nothing here can be trusted right now.</strong> Ask {result.route_to.team.name}:
                <ul>
                  {result.route_to.people.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name}</strong> <span className="muted">({p.reason})</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className={`panels${loading ? ' is-loading' : ''}`}>
            <article className="panel">
              <h2>What can we trust?</h2>
              <DocList trusted={result.trusted} excluded={result.excluded} />
            </article>
            <article className="panel">
              <h2>Who knows about this?</h2>
              {result.bus_factor_risk && (
                <p className="warning">
                  Bus-factor risk: fewer than two people have evidence for this client and domain.
                </p>
              )}
              <ExpertList experts={result.experts} />
            </article>
          </div>
        </>
      )}
    </section>
  )
}
