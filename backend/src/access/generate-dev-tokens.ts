import { signToken } from './auth.js'

// These match the personas in mocks/seed/directory.json
const DEV_PERSONAS = [
  {
    person_id: 'sophie.dubois',
    name: 'Sophie Dubois',
    team_id: 'team-pay',
    client_ids: ['client-x'],
  },
  {
    person_id: 'anna.claes',
    name: 'Anna Claes',
    team_id: 'team-pay',
    client_ids: ['client-x'],
  },
  {
    person_id: 'lead.pay',
    name: 'Pay Team Lead',
    team_id: 'team-pay',
    client_ids: ['client-x'],
  },
]

console.log('\nDev tokens — paste into claude_desktop_config.json or .env:\n')

for (const persona of DEV_PERSONAS) {
  const token = await signToken(persona)
  console.log(`# ${persona.name} (${persona.person_id})`)
  console.log(`CAPY_TOKEN=${token}`)
  console.log()
}
