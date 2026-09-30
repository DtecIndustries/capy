import type { Persona } from '../types'

export function PersonaSwitcher({
  personas,
  current,
  onChange,
}: {
  personas: Persona[]
  current: Persona | undefined
  onChange: (persona: Persona) => void
}) {
  return (
    <label className="persona">
      <span className="muted">Signed in as</span>
      <select
        value={current?.id ?? ''}
        onChange={(e) => {
          const next = personas.find((p) => p.id === e.target.value)
          if (next) onChange(next)
        }}
      >
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.team_name}
          </option>
        ))}
      </select>
    </label>
  )
}
