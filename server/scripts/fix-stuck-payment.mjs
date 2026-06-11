// One-off: add the rzp_order_id column + confirm a payment that Razorpay
// captured but the app never recorded (paid via UPI QR, callback never fired).
// Usage: node scripts/fix-stuck-payment.mjs <phone>
import 'dotenv/config'
import pg from 'pg'

const phone = String(process.argv[2] || '').replace(/\D/g, '')
if (!phone) {
  console.error('usage: node scripts/fix-stuck-payment.mjs <phone>')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

// migration (idempotent)
await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS rzp_order_id TEXT`)
console.log('✓ leads.rzp_order_id column ensured')

const { rows: leadRows } = await pool.query(
  `SELECT paid, slot_date, slot_time FROM leads WHERE phone = $1`,
  [phone],
)
if (!leadRows.length) {
  console.error(`✗ no lead found for ${phone}`)
  process.exit(1)
}
if (leadRows[0].paid) {
  console.log('✓ lead is already marked paid — nothing to do')
  process.exit(0)
}

// confirm the seat they held; if the hold already expired and was released,
// take a free seat for the same date/time instead
let seat = await pool.query(
  `UPDATE slots SET status = 'confirmed', lead_phone = $1, hold_expires_at = NULL
    WHERE id = (SELECT id FROM slots WHERE held_by_phone = $1 AND status = 'pending' ORDER BY id LIMIT 1)
    RETURNING id, slot_date, slot_time`,
  [phone],
)
if (!seat.rows.length) {
  const { slot_date, slot_time } = leadRows[0]
  seat = await pool.query(
    `UPDATE slots SET status = 'confirmed', lead_phone = $1, held_by_phone = NULL, hold_expires_at = NULL
      WHERE id = (SELECT id FROM slots WHERE slot_date = $2 AND slot_time = $3 AND status = 'available' ORDER BY id LIMIT 1)
      RETURNING id, slot_date, slot_time`,
    [phone, slot_date, slot_time],
  )
}
if (seat.rows.length) {
  console.log(`✓ slot ${seat.rows[0].id} confirmed (${seat.rows[0].slot_date.toISOString().slice(0, 10)} ${seat.rows[0].slot_time})`)
} else {
  console.warn('! no seat could be claimed — lead will still be marked paid; assign a slot manually')
}

await pool.query(
  `UPDATE leads SET paid = true, paid_at = now(), slot_status = 'confirmed', updated_at = now() WHERE phone = $1`,
  [phone],
)
console.log(`✓ lead ${phone} marked paid + confirmed`)

await pool.end()
