// Exercises the upgraded Razorpay webhook: multi-key match, idempotency,
// unmatched logging, and refund release. Creates throwaway rows, asserts, cleans up.
import 'dotenv/config'
import pg from 'pg'

const BASE = 'http://localhost:8787'
const PHONE = '9000000111'                 // test lead (impossible-to-collide)
const DATE = '2099-06-01'
const PAY_ID = 'pay_TEST_' + Date.now()
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

const post = (body) =>
  fetch(`${BASE}/api/payment/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.status)

const captured = (id, phone, contact) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id, order_id: 'order_T', amount: 9900, currency: 'INR', email: null, contact, notes: phone ? { phone } : {} } } },
})
const refund = (paymentId) => ({
  event: 'refund.processed',
  payload: { refund: { entity: { id: 'rfnd_T_' + Date.now(), payment_id: paymentId, amount: 9900, currency: 'INR' } } },
})

const q = (sql, p) => pool.query(sql, p)
const slotState = async () =>
  (await q(`SELECT status FROM slots WHERE slot_date=$1 AND held_by_phone=$2 OR (slot_date=$1 AND lead_phone=$2)`, [DATE, PHONE])).rows.map((r) => r.status)
const leadRow = async () =>
  (await q(`SELECT paid, rzp_payment_id, refunded_at, slot_status FROM leads WHERE phone=$1`, [PHONE])).rows[0]

let pass = true
const check = (label, cond) => { console.log(`${cond ? '✓' : '✗ FAIL'} ${label}`); if (!cond) pass = false }

try {
  // setup: a lead with a pending held seat
  await q(`INSERT INTO leads (phone, name, slot_date, slot_time, slot_status)
           VALUES ($1,'__wh_test__',$2,'10.00am-10.30am','pending')
           ON CONFLICT (phone) DO UPDATE SET paid=false, slot_status='pending', slot_date=$2, slot_time='10.00am-10.30am', rzp_payment_id=NULL, refunded_at=NULL`, [PHONE, DATE])
  await q(`DELETE FROM slots WHERE slot_date=$1`, [DATE])
  await q(`INSERT INTO slots (slot_date, slot_time, status, held_by_phone, hold_expires_at)
           VALUES ($1,'10.00am-10.30am','pending',$2, now() + interval '10 min')`, [DATE, PHONE])
  await q(`DELETE FROM webhook_events WHERE event_id IN ($1,$2)`, [PAY_ID, 'pay_TEST_UNMATCHED'])
  await q(`DELETE FROM unmatched_payments WHERE payment_id='pay_TEST_UNMATCHED'`)

  // 1. captured, matched by notes.phone
  const s1 = await post(captured(PAY_ID, PHONE, '+91' + PHONE))
  const l1 = await leadRow()
  check(`captured acked 200 (got ${s1})`, s1 === 200)
  check('lead marked paid', l1.paid === true)
  check('payment id stored', l1.rzp_payment_id === PAY_ID)
  check('slot confirmed', l1.slot_status === 'confirmed')

  // 2. idempotency — same event again must not error / double
  const s2 = await post(captured(PAY_ID, PHONE, '+91' + PHONE))
  check(`duplicate acked 200 (got ${s2})`, s2 === 200)
  const dupCount = (await q(`SELECT COUNT(*)::int n FROM webhook_events WHERE event_id=$1`, [PAY_ID])).rows[0].n
  check('webhook_events has exactly 1 row for the payment', dupCount === 1)

  // 3. unmatched — captured with no notes.phone and a contact no lead has
  const GHOST = '0000000001'
  await q(`DELETE FROM leads WHERE right(regexp_replace(phone,'\\D','','g'),10)=$1`, [GHOST])
  await post(captured('pay_TEST_UNMATCHED', null, '+91' + GHOST))
  const um = (await q(`SELECT amount, currency FROM unmatched_payments WHERE payment_id='pay_TEST_UNMATCHED'`)).rows
  check('unmatched payment logged', um.length === 1 && Number(um[0].amount) === 99)

  // 4. refund — full refund releases the seat + un-marks paid
  await post(refund(PAY_ID))
  const l4 = await leadRow()
  const seatFreed = (await q(`SELECT status FROM slots WHERE slot_date=$1`, [DATE])).rows[0]?.status
  check('lead refunded_at set', !!l4.refunded_at)
  check('lead paid reversed', l4.paid === false)
  check('seat released to available', seatFreed === 'available')

  console.log(pass ? '\n✓ ALL WEBHOOK SCENARIOS PASS' : '\n✗ SOME CHECKS FAILED')
} finally {
  await q(`DELETE FROM slots WHERE slot_date=$1`, [DATE])
  await q(`DELETE FROM leads WHERE phone=$1`, [PHONE])
  await q(`DELETE FROM webhook_events WHERE event_id IN ($1,'pay_TEST_UNMATCHED')`, [PAY_ID])
  await q(`DELETE FROM unmatched_payments WHERE payment_id='pay_TEST_UNMATCHED'`)
  console.log('— test rows cleaned up')
  await pool.end()
  process.exit(pass ? 0 : 1)
}
