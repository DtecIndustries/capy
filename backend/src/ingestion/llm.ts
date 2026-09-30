import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { readSeed } from './seed.js'

// Optional LLM tagging, enabled with CAPY_LLM_TAGGING=claude (credentials from the usual
// ANTHROPIC_* environment). Answers are constrained to the taxonomy's own ids. Any failure,
// refusal or low-confidence answer returns undefined and the keyword rules take over.

const MODEL = 'claude-opus-5-5'
const enabled = process.env.CAPY_LLM_TAGGING === 'claude'
let client: Anthropic | undefined

export interface LlmTags {
  domains: string[]
  client_id: string | null
  confidence: number
  tagged_by: string
}

export async function tagWithLlm(kind: 'document' | 'mail', text: string): Promise<LlmTags | undefined> {
  if (!enabled) return undefined
  const { taxonomy, directory } = readSeed()
  const domainIds = taxonomy.domains.map((d) => d.id) as [string, ...string[]]
  const clientIds = directory.clients.map((c) => c.id) as [string, ...string[]]

  const Tags = z.object({
    domains: z.array(z.enum(domainIds)),
    client_id: z.enum(clientIds).nullable(),
    confidence: z.number(),
  })

  const catalogue = [
    'Domains:',
    ...taxonomy.domains.map((d) => `- ${d.id}: ${d.name} (app ${d.app})`),
    'Clients:',
    ...directory.clients.map((c) => `- ${c.id}: ${c.name} (${c.country}), also called ${(c.aliases ?? []).join(', ')}`),
  ].join('\n')

  try {
    client ??= new Anthropic()
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low', format: zodOutputFormat(Tags) },
      system:
        `You route internal HR/payroll ${kind}s to the knowledge areas they are mainly about. ` +
        'Only choose areas the text is substantially about, not ones it mentions in passing; an empty list is a valid answer. ' +
        'Choose a client only when the text is specific to that client. confidence is between 0 and 1.\n\n' +
        catalogue,
      messages: [{ role: 'user', content: text.slice(0, 60_000) }],
    })
    const parsed = response.stop_reason === 'refusal' ? null : response.parsed_output
    if (!parsed || parsed.confidence < 0.5) return undefined
    return { ...parsed, confidence: Math.min(parsed.confidence, 1), tagged_by: `llm:${MODEL}` }
  } catch (err) {
    console.warn(`LLM tagging failed, using rules: ${(err as Error).message}`)
    return undefined
  }
}
