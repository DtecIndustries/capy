import { readSeed } from './seed.js'
import { tagWithLlm } from './llm.js'

// Tags documents and mails with app/domain, client and country. Deterministic keyword rules
// from the taxonomy seed always run; when an LLM is configured it is asked first and the
// rules are the fallback. Tags only route content to a context; they never decide trust.

export interface Tag {
  domain_id: string
  client_id: string | null
  country: string | null
  confidence: number
  tagged_by: string
}

export interface ClaimAnswer {
  domain_id: string
  claim_id: string
  answer: string
  evidence: string
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[*_`#>|]/g, ' ').replace(/\s+/g, ' ')
}

function occurrences(text: string, phrase: string): number {
  let count = 0
  for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + phrase.length)) count++
  return count
}

function domainScores(weighted: [text: string, weight: number][]): Map<string, number> {
  const scores = new Map<string, number>()
  for (const domain of readSeed().taxonomy.domains) {
    let score = 0
    for (const keyword of domain.keywords ?? []) {
      for (const [text, weight] of weighted) score += occurrences(text, keyword.toLowerCase()) * weight
    }
    if (score > 0) scores.set(domain.id, score)
  }
  return scores
}

export function findClient(text: string): { id: string; country: string } | undefined {
  const normalized = normalize(text)
  return readSeed().directory.clients.find((c) =>
    [c.name, ...(c.aliases ?? [])].some((alias) => normalized.includes(alias.toLowerCase())),
  )
}

export function countryOfClient(clientId: string | null): string | null {
  return readSeed().directory.clients.find((c) => c.id === clientId)?.country ?? null
}

// Title and folder say what a document is about; the body only decides when they don't,
// because procedures mention neighbouring domains in passing.
function tagDocumentByRules(input: { title: string; location: string; content: string; countryHint: string | null }): Tag[] {
  const head = normalize(`${input.title} ${input.location}`)
  const client = findClient(`${input.title} ${input.location}`)
  const country = input.countryHint ?? client?.country ?? null

  let domains = [...domainScores([[head, 1]]).keys()]
  let confidence = 0.9
  if (domains.length === 0) {
    const best = [...domainScores([[normalize(input.content), 1]])].sort((a, b) => b[1] - a[1])[0]
    domains = best && best[1] >= 3 ? [best[0]] : []
    confidence = 0.6
  }
  return domains.map((domain_id) => ({ domain_id, client_id: client?.id ?? null, country, confidence, tagged_by: 'rules' }))
}

export async function tagDocument(input: {
  title: string
  location: string
  content: string
  countryHint: string | null
}): Promise<Tag[]> {
  const llm = await tagWithLlm('document', `${input.title}\n${input.location}\n\n${input.content}`)
  if (llm) {
    return llm.domains.map((domain_id) => ({
      domain_id,
      client_id: llm.client_id,
      country: input.countryHint ?? countryOfClient(llm.client_id),
      confidence: llm.confidence,
      tagged_by: llm.tagged_by,
    }))
  }
  return tagDocumentByRules(input)
}

// A mail gets one domain: subject words count triple, and a single body mention is not enough.
export async function tagMail(input: { subject: string; body: string }): Promise<{ domain_id: string | null; client_id: string | null }> {
  const llm = await tagWithLlm('mail', `${input.subject}\n\n${input.body}`)
  if (llm) return { domain_id: llm.domains[0] ?? null, client_id: llm.client_id }

  const scores = domainScores([
    [normalize(input.subject), 3],
    [normalize(input.body), 1],
  ])
  const best = [...scores].sort((a, b) => b[1] - a[1])[0]
  return {
    domain_id: best && best[1] >= 2 ? best[0] : null,
    client_id: findClient(`${input.subject} ${input.body}`)?.id ?? null,
  }
}

// What a document says on the domain's known questions. A document that matches more than
// one answer is ambiguous and states nothing.
export function extractClaims(domainIds: string[], content: string): ClaimAnswer[] {
  const text = normalize(content)
  const found: ClaimAnswer[] = []
  for (const domain of readSeed().taxonomy.domains.filter((d) => domainIds.includes(d.id))) {
    for (const claim of domain.claims ?? []) {
      const matches = Object.entries(claim.answers)
        .map(([answer, phrases]) => ({ answer, phrase: phrases.find((p) => text.includes(normalize(p))) }))
        .filter((m): m is { answer: string; phrase: string } => m.phrase !== undefined)
      if (matches.length === 1) {
        found.push({ domain_id: domain.id, claim_id: claim.id, answer: matches[0].answer, evidence: matches[0].phrase })
      }
    }
  }
  return found
}
