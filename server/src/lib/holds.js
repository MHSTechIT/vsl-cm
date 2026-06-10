import { query } from '../db.js'
import { sendWhatsApp, rescueMessage } from './whapi.js'

// Release any slot whose pending hold has expired, back to "available".
// The lead who abandoned gets flagged/sent a WhatsApp rescue.
// Called on a timer AND lazily before reads, so scarcity stays honest.
export async function releaseExpiredHolds() {
  const { rows } = await query(
    `UPDATE slots
        SET status = 'available', held_by_phone = NULL, hold_expires_at = NULL
      WHERE status = 'pending' AND hold_expires_at < now()
      RETURNING held_by_phone`,
  )

  for (const row of rows) {
    if (!row.held_by_phone) continue
    // Clear the lead's pending slot and queue the rescue (only if still unpaid).
    const { rows: leadRows } = await query(
      `UPDATE leads
          SET slot_status = NULL, updated_at = now()
        WHERE phone = $1 AND paid = false
        RETURNING phone`,
      [row.held_by_phone],
    )
    if (leadRows.length) {
      await sendWhatsApp(row.held_by_phone, rescueMessage(), 'rescue')
    }
  }
  return rows.length
}

// Start the periodic sweep (every 60s).
export function startHoldSweeper() {
  const tick = () =>
    releaseExpiredHolds().catch((e) =>
      // eslint-disable-next-line no-console
      console.error('[holds] sweep error:', e.message),
    )
  setInterval(tick, 60_000)
}
