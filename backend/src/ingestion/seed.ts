import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { sql } from '../db/client.js'
import type { ChangeEvent } from './contract.js'

// Loads the org directory and taxonomy (mocks/seed) into the database. Stands in for
// Entra ID / the HR directory; safe to run on every start.

export interface Claim {
  id: string
  question: string
  // Answer -> phrases that state it.
  answers: Record<string, string[]>
}

export interface Taxonomy {
  apps: { id: string; name: string }[]
  domains: { id: string; app: string; name: string; owner_team: string; keywords?: string[]; claims?: Claim[] }[]
  domain_links: { from: string; to: string; type: string }[]
}

export interface DirectoryFile {
  teams: { id: string; name: string; app: string }[]
  clients: { id: string; name: string; country: string; aliases?: string[] }[]
  people: {
    id: string
    name: string
    team: string
    status: 'active' | 'left'
    left_at: string | null
    client_bindings: string[]
    email: string
  }[]
}

const defaultSeedDir = join(dirname(fileURLToPath(import.meta.url)), '../../../mocks/seed')

let cached: { taxonomy: Taxonomy; directory: DirectoryFile } | undefined

export function readSeed(seedDir = process.env.SEED_DIR ?? defaultSeedDir) {
  cached ??= {
    taxonomy: JSON.parse(readFileSync(join(seedDir, 'taxonomy.json'), 'utf8')) as Taxonomy,
    directory: JSON.parse(readFileSync(join(seedDir, 'directory.json'), 'utf8')) as DirectoryFile,
  }
  return cached
}

export async function loadSeed(): Promise<ChangeEvent[]> {
  const { taxonomy, directory } = readSeed()

  await sql.begin(async (tx) => {
    for (const a of taxonomy.apps) {
      await tx`INSERT INTO app (id, name) VALUES (${a.id}, ${a.name})
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`
    }
    for (const t of directory.teams) {
      await tx`INSERT INTO team (id, name, app_id) VALUES (${t.id}, ${t.name}, ${t.app})
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, app_id = EXCLUDED.app_id`
    }
    for (const d of taxonomy.domains) {
      await tx`INSERT INTO domain (id, app_id, name, owner_team_id) VALUES (${d.id}, ${d.app}, ${d.name}, ${d.owner_team})
               ON CONFLICT (id) DO UPDATE SET app_id = EXCLUDED.app_id, name = EXCLUDED.name, owner_team_id = EXCLUDED.owner_team_id`
    }
    for (const l of taxonomy.domain_links) {
      await tx`INSERT INTO domain_link (from_domain_id, to_domain_id, type) VALUES (${l.from}, ${l.to}, ${l.type})
               ON CONFLICT (from_domain_id, to_domain_id) DO UPDATE SET type = EXCLUDED.type`
    }
    for (const c of directory.clients) {
      await tx`INSERT INTO client (id, name, country) VALUES (${c.id}, ${c.name}, ${c.country})
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country`
    }
    for (const p of directory.people) {
      await tx`INSERT INTO person (id, name, team_id, status, left_at, email)
               VALUES (${p.id}, ${p.name}, ${p.team}, ${p.status}, ${p.left_at}, ${p.email})
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, team_id = EXCLUDED.team_id,
                 status = EXCLUDED.status, left_at = EXCLUDED.left_at, email = EXCLUDED.email`
      await tx`DELETE FROM client_binding WHERE person_id = ${p.id} AND NOT (client_id = ANY(${p.client_bindings}))`
      for (const clientId of p.client_bindings) {
        await tx`INSERT INTO client_binding (person_id, client_id) VALUES (${p.id}, ${clientId}) ON CONFLICT DO NOTHING`
      }
    }
  })

  // Leavers become a ledger event once.
  const recorded = await sql<{ subject_id: string }[]>`SELECT subject_id FROM event WHERE type = 'person_left'`
  const known = new Set(recorded.map((r) => r.subject_id))
  return directory.people
    .filter((p) => p.status === 'left' && p.left_at && !known.has(p.id))
    .map((p) => ({
      source_type: 'directory',
      source_id: p.id,
      action: 'person_left',
      actor: 'directory',
      timestamp: new Date(p.left_at!).toISOString(),
      details: { team: p.team, client_bindings: p.client_bindings },
    }))
}
