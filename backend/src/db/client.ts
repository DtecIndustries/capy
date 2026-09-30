import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://capy:capy@localhost:5432/capy'

// DATABASE_POOL_MAX=1 for single-session databases such as the PGlite used in tests.
export const sql = postgres(DATABASE_URL, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  onnotice: () => {},
})
