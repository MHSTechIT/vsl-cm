import { query } from '../db.js'

// ============================================================
// Scarcity drip
// ------------------------------------------------------------
// Every opened day carries DAY_SEATS seats. Only DAY_OPEN are
// bookable at first — the rest are created as status='blocked',
// which the landing page counts as already booked. Each blocked
// seat carries a release_wave (admin-adjustable):
//   ≥ RELEASE_AT paid     → wave-1 blocked seats open up
//   ≥ RELEASE_ALL_AT paid → every remaining blocked seat opens
// ============================================================
export const DAY_SEATS = 20
export const DAY_OPEN = 10
export const RELEASE_AT = 5
export const RELEASE_ALL_AT = 10

// Bring one date's blocked seats in line with its paid-booking count.
export async function applySlotDrip(date) {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'confirmed') AS paid,
            COUNT(*) FILTER (WHERE status = 'blocked')   AS blocked
       FROM slots WHERE slot_date = $1`,
    [date],
  )
  const paid = Number(rows[0].paid)
  if (!Number(rows[0].blocked)) return 0

  if (paid >= RELEASE_ALL_AT) {
    const r = await query(
      `UPDATE slots SET status = 'available', release_wave = NULL
        WHERE slot_date = $1 AND status = 'blocked'`,
      [date],
    )
    return r.rowCount
  }
  if (paid >= RELEASE_AT) {
    // seats with no wave (legacy rows) release with the first wave
    const r = await query(
      `UPDATE slots SET status = 'available', release_wave = NULL
        WHERE slot_date = $1 AND status = 'blocked' AND COALESCE(release_wave, 1) = 1`,
      [date],
    )
    return r.rowCount
  }
  return 0
}

// Sweep every date that still has blocked seats (lazy, before reads).
export async function applyDripAll() {
  const { rows } = await query(`SELECT DISTINCT slot_date FROM slots WHERE status = 'blocked'`)
  for (const r of rows) await applySlotDrip(r.slot_date)
}
