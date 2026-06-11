// One-off READ-ONLY diagnostic: show lead + slot state for a phone fragment.
// Usage: node scripts/check-lead.mjs 8754689554
import 'dotenv/config'
import pg from 'pg'

const frag = process.argv[2]
if (!frag) {
  console.error('usage: node scripts/check-lead.mjs <phone-digits>')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

const leads = await pool.query(
  `SELECT phone, name, registered_at, watch_percent, form2_submitted,
          slot_date, slot_time, slot_status, paid, paid_at, needs_wa, updated_at
     FROM leads WHERE phone LIKE $1 ORDER BY registered_at DESC`,
  [`%${frag}%`],
)
console.log('--- leads ---')
console.table(leads.rows)

const slots = await pool.query(
  `SELECT id, slot_date, slot_time, status, held_by_phone, lead_phone, hold_expires_at
     FROM slots
    WHERE held_by_phone LIKE $1 OR lead_phone LIKE $1
    ORDER BY id`,
  [`%${frag}%`],
)
console.log('--- slots touching this phone ---')
console.table(slots.rows)

await pool.end()
