// Extracts app, domain and client from a free-text query using keyword matching.
// No LLM needed — the taxonomy is small and the keywords are distinct enough.

interface RouteResult {
  app?: string
  domain_id?: string
  client_id?: string
}

const APP_KEYWORDS: [string, string][] = [
  ['pay',      'pay'],
  ['payroll',  'pay'],
  ['salary',   'pay'],
  ['salaire',  'pay'],
  ['loon',     'pay'],
  ['hr',       'hr'],
  ['human',    'hr'],
  ['onboard',  'hr'],
  ['contract', 'hr'],
  ['time',     'time'],
  ['absence',  'time'],
  ['timesheet','time'],
]

const DOMAIN_KEYWORDS: [string, string][] = [
  ['sick',       'pay.sick-leave'],
  ['ziekte',     'pay.sick-leave'],
  ['maladie',    'pay.sick-leave'],
  ['sick leave', 'pay.sick-leave'],
  ['year-end',   'pay.year-end'],
  ['yearend',    'pay.year-end'],
  ['eindejaar',  'pay.year-end'],
  ['gross',      'pay.gross-to-net'],
  ['net',        'pay.gross-to-net'],
  ['brut',       'pay.gross-to-net'],
  ['absence',    'time.absence'],
  ['timesheet',  'time.timesheets'],
  ['feuille',    'time.timesheets'],
  ['onboard',    'hr.onboarding'],
  ['contract',   'hr.contracts'],
  ['contrat',    'hr.contracts'],
]

const CLIENT_KEYWORDS: [string, string][] = [
  ['scheldemond', 'client-x'],
  ['polderveld',  'client-y'],
  ['ardenne',     'client-z'],
  ['lumière',     'client-w'],
  ['lumiere',     'client-w'],
  ['atelier',     'client-w'],
  ['client x',    'client-x'],
  ['client y',    'client-y'],
  ['client z',    'client-z'],
  ['client w',    'client-w'],
  ['client-x',    'client-x'],
  ['client-y',    'client-y'],
  ['client-z',    'client-z'],
  ['client-w',    'client-w'],
]

export function routeQuery(query: string): RouteResult {
  const q = query.toLowerCase()

  let domain_id: string | undefined
  for (const [keyword, id] of DOMAIN_KEYWORDS) {
    if (q.includes(keyword)) { domain_id = id; break }
  }

  let app: string | undefined
  if (domain_id) {
    app = domain_id.split('.')[0]
  } else {
    for (const [keyword, id] of APP_KEYWORDS) {
      if (q.includes(keyword)) { app = id; break }
    }
  }

  let client_id: string | undefined
  for (const [keyword, id] of CLIENT_KEYWORDS) {
    if (q.includes(keyword)) { client_id = id; break }
  }

  return { app, domain_id, client_id }
}
