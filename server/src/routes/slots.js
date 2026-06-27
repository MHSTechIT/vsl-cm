import { Router } from 'express'
import { query } from '../db.js'
import { config } from '../config.js'
import { releaseExpiredHolds } from '../lib/holds.js'
import { applySlotDrip, applyDripAll } from '../lib/drip.js'
import { parseFunnel } from '../lib/funnel.js'
import { watiConfigured, watiPaymentSuccess } from '../lib/wati.js'
import { sendWhatsApp, confirmationMessage } from '../lib/whapi.js'
import { ah } from '../lib/ah.js'

export const slotsRouter = Router()

// slot_time is a label like "3.30pm-4.00pm" / "11.00am-11.30am". Parse its START
// time and combine with the date as IST (+05:30, no DST) → epoch ms. A slot is
// "past" (auto-closed) once its start time has passed.
export function slotStartEpoch(dateISO, label) {
  const m = String(label).trim().match(/^(\d{1,2})\.(\d{2})\s*(am|pm)/i)
  if (!m) return null
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  const ms = Date.parse(`${dateISO}T${String(h).padStart(2, '0')}:${m[2]}:00+05:30`)
  return Number.isNaN(ms) ? null : ms
}
export function isPastSlot(dateISO, label, nowMs = Date.now()) {
  const start = slotStartEpoch(dateISO, label)
  return start != null && start <= nowMs
}

// Dates that still have at least one available slot (for the calendar).
slotsRouter.get(
  '/dates',
  ah(async (req, res) => {
    const funnel = parseFunnel(req.query.funnel)
    await releaseExpiredHolds()
    await applyDripAll()
    // Only 'available' seats are bookable. A 'pending' seat is RESERVED for the
    // payer during the 15-min hold window (it auto-frees on expiry, see
    // releaseExpiredHolds). 'blocked'/'permanent' stay closed (scarcity /
    // manually reserved).
    // A slot is bookable only while its start time is still in the future (IST).
    // Past time slots auto-close — they never show on the calendar/booking form.
    const { rows } = await query(
      `SELECT slot_date, slot_time,
              COUNT(*) FILTER (WHERE status = 'available') AS available
         FROM slots
        WHERE slot_date >= CURRENT_DATE AND funnel = $1
        GROUP BY slot_date, slot_time`,
      [funnel],
    )
    // dates the admin has switched OFF — hidden from the public calendar
    const { rows: offDays } = await query(
      `SELECT slot_date FROM slot_days WHERE active = false AND funnel = $1`,
      [funnel],
    )
    const hidden = new Set(offDays.map((r) => isoDate(r.slot_date)))
    const now = Date.now()
    const byDate = new Map()
    for (const r of rows) {
      const avail = Number(r.available)
      if (avail <= 0) continue
      const d = isoDate(r.slot_date)
      if (hidden.has(d)) continue // admin turned this date off
      if (isPastSlot(d, r.slot_time, now)) continue // skip times already passed
      byDate.set(d, (byDate.get(d) || 0) + avail)
    }
    res.json(
      [...byDate.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, available]) => ({ date, available })),
    )
  }),
)

// Times for a date. Only 'available' seats are bookable (`left`). A seat someone
// is mid-payment on ('pending') is RESERVED for them during the 15-min hold
// window — it isn't bookable by others, and auto-frees on expiry. 'blocked'/
// 'permanent' stay closed (scarcity / manually reserved). A seat is only
// permanently 'confirmed' (booked) once payment actually completes.
slotsRouter.get(
  '/',
  ah(async (req, res) => {
    await releaseExpiredHolds()
    const date = String(req.query.date || '')
    const funnel = parseFunnel(req.query.funnel)
    if (!date) return res.status(400).json({ error: 'date required' })
    // date switched off by the admin → no bookable times
    const off = await query(
      `SELECT 1 FROM slot_days WHERE slot_date = $1 AND funnel = $2 AND active = false`,
      [date, funnel],
    )
    if (off.rows.length) return res.json([])
    await applySlotDrip(date)
    const { rows } = await query(
      `SELECT slot_time,
              COUNT(*) FILTER (WHERE status = 'available') AS left,
              COUNT(*) AS total
         FROM slots
        WHERE slot_date = $1 AND funnel = $2
        GROUP BY slot_time
        ORDER BY MIN(id)`,
      [date, funnel],
    )
    const now = Date.now()
    res.json(
      rows
        .filter((r) => !isPastSlot(date, r.slot_time, now)) // hide past times
        .map((r) => ({ time: r.slot_time, left: Number(r.left), total: Number(r.total) })),
    )
  }),
)

// FORM 2 — select a time. Atomically claims ONE available seat for that time.
slotsRouter.post(
  '/hold',
  ah(async (req, res) => {
    await releaseExpiredHolds()
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    const name = String(req.body?.name || '').trim()
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const funnel = parseFunnel(req.body?.funnel)
    if (!phone || !date || !time) {
      return res.status(400).json({ error: 'phone, date and time required' })
    }
    if (isPastSlot(date, time)) {
      return res.status(409).json({ error: 'this time has already passed — please pick another' })
    }

    const mins = config.holdWindowMinutes

    const { rows } = await query(
      `UPDATE slots
          SET status = 'pending', held_by_phone = $1,
              hold_expires_at = now() + ($4 || ' minutes')::interval
        WHERE id = (
          SELECT id FROM slots
           WHERE slot_date = $2 AND slot_time = $3 AND status = 'available' AND funnel = $5
           ORDER BY id LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, slot_date, slot_time, hold_expires_at`,
      [phone, date, time, String(mins), funnel],
    )
    if (!rows.length) {
      return res.status(409).json({ error: 'this time is now full — please pick another' })
    }
    const slot = rows[0]
    const slotId = slot.id

    // one active hold per lead — release any other pending seat this phone holds
    await query(
      `UPDATE slots SET status = 'available', held_by_phone = NULL, hold_expires_at = NULL
        WHERE held_by_phone = $1 AND status = 'pending' AND id <> $2`,
      [phone, slotId],
    )

    await query(
      `UPDATE leads
          SET name = COALESCE(NULLIF($2, ''), name),
              form2_submitted = true,
              slot_date = $3, slot_time = $4, slot_status = 'pending',
              updated_at = now()
        WHERE phone = $1`,
      [phone, name, isoDate(slot.slot_date), slot.slot_time],
    )

    res.json({
      ok: true,
      slotId: slot.id,
      date: isoDate(slot.slot_date),
      time: slot.slot_time,
      holdExpiresAt: slot.hold_expires_at,
      holdWindowMinutes: mins,
    })
  }),
)

// Release a seat the payer is holding — called when they exit the Razorpay
// popup (or cancel) so the seat goes back to 'available' immediately instead
// of waiting for the hold to expire. Only frees a 'pending' seat held by this
// phone, so a seat already 'confirmed' by a successful payment is never freed.
slotsRouter.post(
  '/release',
  ah(async (req, res) => {
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    if (!phone) return res.status(400).json({ error: 'phone required' })

    const { rows } = await query(
      `UPDATE slots
          SET status = 'available', held_by_phone = NULL, hold_expires_at = NULL
        WHERE held_by_phone = $1 AND status = 'pending'
        RETURNING id`,
      [phone],
    )
    // mirror the lead's slot status back to nothing-booked
    await query(
      `UPDATE leads
          SET slot_status = NULL, updated_at = now()
        WHERE phone = $1 AND slot_status = 'pending'`,
      [phone],
    )
    res.json({ ok: true, released: rows.length })
  }),
)

// FREE funnel — confirm the held seat directly, no payment. Flips the lead's
// pending hold (in the free funnel) to 'confirmed' and fires the booking
// WhatsApp. There is no money involved, so the lead is marked booked via
// payment_status = 'free' (not 'success').
slotsRouter.post(
  '/free-confirm',
  ah(async (req, res) => {
    await releaseExpiredHolds()
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    if (!phone) return res.status(400).json({ error: 'phone required' })

    // Claim THIS phone's pending free-funnel hold → confirmed.
    const { rows } = await query(
      `UPDATE slots
          SET status = 'confirmed', lead_phone = $1, hold_expires_at = NULL
        WHERE id = (
          SELECT id FROM slots
           WHERE held_by_phone = $1 AND status = 'pending' AND funnel = 'free'
           ORDER BY id LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING slot_date, slot_time`,
      [phone],
    )
    if (!rows.length) {
      return res.status(409).json({ error: 'no held slot to confirm — please pick a time again' })
    }
    const slot = rows[0]
    const date = isoDate(slot.slot_date)
    const time = slot.slot_time

    await query(
      `UPDATE leads
          SET slot_date = $2, slot_time = $3, slot_status = 'confirmed',
              payment_status = 'free', wa_payment = 'success', updated_at = now()
        WHERE phone = $1`,
      [phone, date, time],
    )

    // Booking-confirmation WhatsApp (same templates as a paid booking).
    if (watiConfigured()) {
      const dmy = date.split('-').reverse().join('/') // YYYY-MM-DD → DD/MM/YYYY
      watiPaymentSuccess(phone, { date: dmy, time }).catch(() => {})
    } else {
      sendWhatsApp(phone, confirmationMessage(date, time), 'confirmation').catch(() => {})
    }

    res.json({ ok: true, date, time })
  }),
)

export function isoDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}
