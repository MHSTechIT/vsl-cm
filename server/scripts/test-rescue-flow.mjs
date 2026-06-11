// Round-trip test for the expired-hold rescue flow. Creates a clearly-fake
// lead + slot with an already-expired hold, runs the real sweeper, checks the
// outcome, then deletes the test rows.
import 'dotenv/config'
import { query, pool } from '../src/db.js'
import { releaseExpiredHolds } from '../src/lib/holds.js'

const PHONE = '00000000999' // impossible number — test row only

try {
  await query(`INSERT INTO leads (phone, name, slot_status) VALUES ($1, '__rescue_test__', 'pending')
               ON CONFLICT (phone) DO UPDATE SET slot_status = 'pending', needs_wa = NULL, paid = false`, [PHONE])
  await query(`INSERT INTO slots (slot_date, slot_time, status, held_by_phone, hold_expires_at)
               VALUES ('2099-01-01', '__test__', 'pending', $1, now() - interval '1 minute')`, [PHONE])

  const released = await releaseExpiredHolds()
  console.log(`sweeper released ${released} hold(s)`)

  const { rows } = await query(
    `SELECT slot_status, needs_wa FROM leads WHERE phone = $1`, [PHONE])
  const { rows: slotRows } = await query(
    `SELECT status, held_by_phone FROM slots WHERE slot_date = '2099-01-01' AND slot_time = '__test__'`)

  const lead = rows[0]
  const slot = slotRows[0]
  console.log('lead after sweep :', lead)
  console.log('slot after sweep :', slot)

  const pass =
    slot.status === 'available' &&
    slot.held_by_phone === null &&
    lead.slot_status === null &&
    lead.needs_wa === 'rescue'
  console.log(pass ? '✓ PASS — rescue flow works' : '✗ FAIL — rescue flow broken')
} finally {
  await query(`DELETE FROM slots WHERE slot_date = '2099-01-01' AND slot_time = '__test__'`)
  await query(`DELETE FROM leads WHERE phone = $1`, [PHONE])
  console.log('test rows cleaned up')
  await pool.end?.()
  process.exit(0)
}
