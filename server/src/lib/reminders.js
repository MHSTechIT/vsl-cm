import { query } from '../db.js'
import { watiConfigured, watiOneHour } from './wati.js'
import { slotStartEpoch } from '../routes/slots.js'

const HOUR_MS = 60 * 60 * 1000

// Send the "one_hour_togo" reminder to paid, confirmed bookings whose slot
// starts within the next hour. The paid-only filter covers BOTH Razorpay
// (paid=true, payment_status 'success') and manual admin bookings (paid=true,
// payment_status 'manual'); the free funnel (paid=false) is excluded.
// wa_1h_sent guards it to once per booking.
export async function sweepOneHourReminders() {
  if (!watiConfigured()) return 0
  const { rows } = await query(
    `SELECT phone, name, slot_date, slot_time FROM leads
      WHERE paid = true AND slot_status = 'confirmed'
        AND wa_1h_sent = false AND slot_date IS NOT NULL AND slot_time IS NOT NULL`,
  )
  const now = Date.now()
  let sent = 0
  for (const l of rows) {
    const start = slotStartEpoch(l.slot_date, l.slot_time)
    if (start == null) continue
    const remaining = start - now
    // Only when the slot is still upcoming AND within the next hour.
    if (remaining <= 0 || remaining > HOUR_MS) continue

    // Claim the send (flip the flag) BEFORE firing so an overlapping tick can't
    // double-send. If another tick already claimed it, skip.
    const claim = await query(
      `UPDATE leads SET wa_1h_sent = true
        WHERE phone = $1 AND wa_1h_sent = false RETURNING phone`,
      [l.phone],
    )
    if (!claim.rows.length) continue

    const dmy = String(l.slot_date).split('-').reverse().join('/') // YYYY-MM-DD → DD/MM/YYYY
    try {
      await watiOneHour(l.phone, { date: dmy, time: l.slot_time })
      sent++
    } catch (e) {
      // Roll the flag back so the next tick retries this lead.
      await query(`UPDATE leads SET wa_1h_sent = false WHERE phone = $1`, [l.phone]).catch(() => {})
      // eslint-disable-next-line no-console
      console.error('[wati] one_hour_togo failed:', e.message)
    }
  }
  return sent
}

// Start the periodic reminder sweep (every 60s), mirroring startHoldSweeper().
export function startOneHourReminder() {
  const tick = () =>
    sweepOneHourReminders().catch((e) =>
      // eslint-disable-next-line no-console
      console.error('[reminders] one-hour sweep error:', e.message),
    )
  setInterval(tick, 60_000)
}
