import { readSeed } from '../ingestion/seed.js'
import { signToken } from './auth.js'

// Prints a token for every active person in mocks/seed/directory.json.
const { directory } = readSeed()

console.log('\nDev tokens — paste into claude_desktop_config.json or .env:\n')

for (const person of directory.people.filter((p) => p.status === 'active')) {
  const token = await signToken({
    person_id: person.id,
    name: person.name,
    team_id: person.team,
    client_ids: person.client_bindings,
  })
  console.log(`# ${person.name} (${person.id}, ${person.team}, clients: ${person.client_bindings.join(', ')})`)
  console.log(`CAPY_TOKEN=${token}`)
  console.log()
}
