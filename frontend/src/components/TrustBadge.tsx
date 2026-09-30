import type { Verdict } from '../types'
import { Capybara, type Mood } from './Capybara'

const VERDICTS: Record<Verdict, { mood: Mood; label: string; tone: string }> = {
  trusted: { mood: 'relaxed', label: 'Trusted', tone: 'good' },
  unverified: { mood: 'eyebrow', label: 'Not reviewed', tone: 'warn' },
  scope_mismatch: { mood: 'eyebrow', label: 'Wrong scope', tone: 'bad' },
  conflict: { mood: 'sweating', label: 'Conflict', tone: 'bad' },
  stale: { mood: 'asleep', label: 'Stale', tone: 'muted' },
  unowned: { mood: 'asleep', label: 'No active owner', tone: 'muted' },
}

export function TrustBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICTS[verdict]
  return (
    <span className={`badge badge-${v.tone}`}>
      <Capybara mood={v.mood} size={34} />
      <span>{v.label}</span>
    </span>
  )
}
