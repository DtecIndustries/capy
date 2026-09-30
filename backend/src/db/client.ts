import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://capy:capy@localhost:5432/capy'

export const sql = postgres(DATABASE_URL)
