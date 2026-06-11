import { query } from '../db.js'
import { sendWhatsApp } from './whapi.js'
import { watiConfigured, watiOneHour } from './wati.js'
import { isoDate } from '../routes/slots.js'

// ============================================================
// 1-hour-before reminder. Marks leads.wa_1h_sent = true and fires a WhatsApp
// once "now" is inside the hour leading up to the booked slot's start time.
// If that window is missed (server down, etc.) the flag stays false — so the
// admin registry shows "no" exactly when no reminder went out in time.
// ============================================================

// "8.00am-9.00am" / "12.30pm-1.00pm" → { h, min } of the START time (24h).
function parseStart(slotTime) {
  const token = String(slotTime || '').split('-')[0].trim()
  const m = token.match(/(\d{1,2})\.(\d{2})\s*(am|pm)/i)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const pm = m[3].toLowerCase() === 'pm'
  if (pm && h !== 12) h += 12
  if (!pm && h === 12) h = 0
  return { h, min }
}

// Slot start as a real instant, treating the stored time as IST (UTC+05:30).
function slotStartMs(dateStr, t) {
  const pad = (n) => String(n).padStart(2, '0')
  const ms = Date.parse(`${dateStr}T${pad(t.h)}:${pad(t.min)}:00+05:30`)
  return Number.isNaN(ms) ? null : ms
}

export async function sweepOneHourReminders() {
  const { rows } = await query(
    `SELECT phone, name, slot_date, slot_time
       FROM leads
      WHERE paid = true AND wa_1h_sent = false
        AND slot_status = 'confirmed' AND slot_date IS NOT NULL
        AND slot_date >= CURRENT_DATE - 1`,
  )
  const now = Date.now()
  const HOUR = 60 * 60 * 1000
  let fired = 0
  for (const r of rows) {
    const t = parseStart(r.slot_time)
    if (!t) continue
    const start = slotStartMs(isoDate(r.slot_date), t)
    if (start == null) continue
    // inside the final hour before the slot (and not yet started)
    if (now >= start - HOUR && now < start) {
      await query(`UPDATE leads SET wa_1h_sent = true, updated_at = now() WHERE phone = $1`, [r.phone])
      const date = isoDate(r.slot_date)
      if (watiConfigured()) {
        watiOneHour(r.phone).catch((e) =>
          // eslint-disable-next-line no-console
          console.error('[wati] one_hour failed:', e.message),
        )
      } else {
        sendWhatsApp(
          r.phone,
          `Reminder: your health assessment call is in about an hour — ${date} at ${r.slot_time}. Please be available. — My Health School`,
          'reminder',
        ).catch(() => {})
      }
      fired++
    }
  }
  return fired
}

export function startReminderSweeper() {
  const tick = () =>
    sweepOneHourReminders().catch((e) =>
      // eslint-disable-next-line no-console
      console.error('[reminders] sweep error:', e.message),
    )
  setInterval(tick, 60_000)
}
