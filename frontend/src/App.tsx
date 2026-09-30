import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api'
import { Capybara, MOODS, type Mood } from './components/Capybara'
import logo from './assets/logo.jpeg'
import { PersonaSwitcher } from './components/PersonaSwitcher'
import { Health } from './pages/Health'
import { Ledger } from './pages/Ledger'
import { Lookup } from './pages/Lookup'
import { Provenance } from './pages/Provenance'
import type { Persona, Taxonomy } from './types'

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.replace(/^#/, '') || '/'
}

function Legend() {
  return (
    <footer className="legend">
      {(Object.keys(MOODS) as Mood[]).map((m) => (
        <span key={m}>
          <Capybara mood={m} size={28} /> {MOODS[m].meaning}
        </span>
      ))}
    </footer>
  )
}

export function App() {
  const route = useHashRoute()
  const [personas, setPersonas] = useState<Persona[]>([])
  const [persona, setPersona] = useState<Persona>()
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .personas()
      .then((list) => {
        setPersonas(list)
        const remembered = list.find((p) => p.token === getToken())
        choose(remembered ?? list.find((p) => p.id === 'anna.claes') ?? list[0])
      })
      .catch(() => setError('Could not load personas. Is the backend running with CAPY_DEV_PERSONAS=true?'))
  }, [])

  function choose(p: Persona | undefined) {
    if (!p) return
    setToken(p.token)
    setPersona(p)
    setTaxonomy(null)
    api.taxonomy().then(setTaxonomy).catch((e: Error) => setError(e.message))
  }

  const provenance = /^\/provenance\/(.+)$/.exec(route)

  return (
    <div className="app">
      <header className="top">
        <a href="#/" className="brand">
          <img src={logo} alt="Capybara Ledger" style={{ height: 36, borderRadius: 6 }} />
          <span>
            Capybara Ledger
            <small>Who knows about this, and what can we trust?</small>
          </span>
        </a>
        <nav>
          <a href="#/" className={route === '/' || provenance ? 'active' : ''}>Lookup</a>
          <a href="#/health" className={route === '/health' ? 'active' : ''}>Health board</a>
          <a href="#/ledger" className={route === '/ledger' ? 'active' : ''}>Ledger</a>
        </nav>
        {personas.length > 0 && <PersonaSwitcher personas={personas} current={persona} onChange={choose} />}
      </header>

      <main>
        {error && <p className="error">{error}</p>}
        {persona && taxonomy && (
          <>
            {provenance ? (
              <Provenance documentId={decodeURIComponent(provenance[1])} />
            ) : route === '/health' ? (
              <Health taxonomy={taxonomy} />
            ) : route === '/ledger' ? (
              <Ledger />
            ) : (
              <Lookup key={persona.id} taxonomy={taxonomy} />
            )}
          </>
        )}
      </main>
      <Legend />
    </div>
  )
}
