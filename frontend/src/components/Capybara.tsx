// The capybara's mood is the status badge (docs/SOLUTION.md, "The capybara").

export type Mood = 'relaxed' | 'eyebrow' | 'sweating' | 'phone' | 'asleep'

export const MOODS: Record<Mood, { label: string; meaning: string }> = {
  relaxed: { label: 'Relaxed', meaning: 'Verified, current, in scope, owned' },
  eyebrow: { label: 'Raised eyebrow', meaning: 'Not reviewed, or right document for another country or client' },
  sweating: { label: 'Sweating', meaning: 'Two current documents disagree' },
  phone: { label: 'Holding a phone', meaning: 'Nothing to trust here, ask the named owner' },
  asleep: { label: 'Asleep under a dusty blanket', meaning: 'Stale or ownerless' },
}

const FUR = '#a8784f'
const SNOUT = '#8c6140'
const DARK = '#3b2a1e'

function Eyes({ mood }: { mood: Mood }) {
  if (mood === 'relaxed' || mood === 'asleep') {
    return (
      <g stroke={DARK} strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M18 27 q4 3 8 0" />
        <path d="M38 27 q4 3 8 0" />
      </g>
    )
  }
  return (
    <g fill={DARK}>
      <circle cx="22" cy="27" r="2.6" />
      <circle cx="42" cy="27" r="2.6" />
      {mood === 'eyebrow' && <path d="M16 19 l10 -4" stroke={DARK} strokeWidth="2.2" strokeLinecap="round" />}
      {mood === 'eyebrow' && <path d="M38 22 h8" stroke={DARK} strokeWidth="2.2" strokeLinecap="round" />}
    </g>
  )
}

export function Capybara({ mood, size = 40, title }: { mood: Mood; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title ?? MOODS[mood].label}>
      <title>{title ?? `${MOODS[mood].label}: ${MOODS[mood].meaning}`}</title>
      <circle cx="15" cy="15" r="5" fill={SNOUT} />
      <circle cx="49" cy="15" r="5" fill={SNOUT} />
      <rect x="7" y="13" width="50" height="41" rx="17" fill={FUR} />
      <rect x="14" y="33" width="36" height="20" rx="10" fill={SNOUT} />
      <ellipse cx="26" cy="40" rx="2.2" ry="1.4" fill={DARK} />
      <ellipse cx="38" cy="40" rx="2.2" ry="1.4" fill={DARK} />
      <path d="M28 47 q4 2.5 8 0" stroke={DARK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <Eyes mood={mood} />
      {mood === 'sweating' && (
        <g fill="#5aa9e6">
          <path d="M53 20 q3 5 0 7 q-3 -2 0 -7z" />
          <path d="M57 30 q2.4 4 0 5.6 q-2.4 -1.6 0 -5.6z" />
        </g>
      )}
      {mood === 'phone' && (
        <g>
          <rect x="47" y="30" width="11" height="19" rx="2.5" fill="#2d3748" transform="rotate(12 52 40)" />
          <rect x="49" y="33" width="7" height="11" rx="1" fill="#9fd3f5" transform="rotate(12 52 40)" />
        </g>
      )}
      {mood === 'asleep' && (
        <g>
          <path d="M5 46 h54 v10 q-27 6 -54 0z" fill="#b9b1a3" />
          <path d="M9 49 h46 M11 53 h42" stroke="#9c9486" strokeWidth="1.2" strokeDasharray="3 3" />
          <text x="48" y="12" fontSize="10" fontWeight="700" fill="#7a8794">z</text>
          <text x="55" y="6" fontSize="7" fontWeight="700" fill="#7a8794">z</text>
        </g>
      )}
    </svg>
  )
}
