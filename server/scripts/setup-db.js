// Creates the database (if missing) then applies db/schema.sql.
// Usage: npm run db:setup
import 'dotenv/config'
import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
const url = new URL(process.env.DATABASE_URL)
const dbName = decodeURIComponent(url.pathname.slice(1))

async function ensureDatabase() {
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres' // connect to the maintenance DB
  const client = new pg.Client({ connectionString: adminUrl.toString(), ssl })
  await client.connect()
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
  if (rows.length === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`)
    console.log(`✓ created database "${dbName}"`)
  } else {
    console.log(`• database "${dbName}" already exists`)
  }
  await client.end()
}

async function applySchema() {
  const sql = await readFile(join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  const client = new pg.Client({ connectionString: url.toString(), ssl })
  await client.connect()
  await client.query(sql)
  await client.end()
  console.log('✓ schema applied (leads, slots)')
}

async function main() {
  await ensureDatabase()
  await applySchema()
}

main().catch((err) => {
  console.error('✗ db setup failed:', err.message)
  process.exit(1)
})
