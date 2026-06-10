import { Router } from 'express'
import { query } from '../db.js'
import { config } from '../config.js'
import { releaseExpiredHolds } from '../lib/holds.js'
import { ah } from '../lib/ah.js'

export const slotsRouter = Router()

// Dates that still have at least one available slot (for the calendar).
slotsRouter.get(
  '/dates',
  ah(async (_req, res) => {
    await releaseExpiredHolds()
    const { rows } = await query(
      `SELECT slot_date,
              COUNT(*) FILTER (WHERE status = 'available') AS available
         FROM slots
        WHERE slot_date >= CURRENT_DATE
        GROUP BY slot_date
        HAVING COUNT(*) FILTER (WHERE status = 'available') > 0
        ORDER BY slot_date`,
    )
    res.json(rows.map((r) => ({ date: isoDate(r.slot_date), available: Number(r.available) })))
  }),
)

// Times for a date with seats left (full times return left:0 so the booking
// form can show them disabled instead of hiding them).
slotsRouter.get(
  '/',
  ah(async (req, res) => {
    await releaseExpiredHolds()
    const date = String(req.query.date || '')
    if (!date) return res.status(400).json({ error: 'date required' })
    const { rows } = await query(
      `SELECT slot_time,
              COUNT(*) FILTER (WHERE status='available') AS left
         FROM slots
        WHERE slot_date = $1
        GROUP BY slot_time
        ORDER BY MIN(id)`,
      [date],
    )
    res.json(rows.map((r) => ({ time: r.slot_time, left: Number(r.left) })))
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
    if (!phone || !date || !time) {
      return res.status(400).json({ error: 'phone, date and time required' })
    }

    const mins = config.holdWindowMinutes

    const { rows } = await query(
      `UPDATE slots
          SET status = 'pending', held_by_phone = $1,
              hold_expires_at = now() + ($4 || ' minutes')::interval
        WHERE id = (
          SELECT id FROM slots
           WHERE slot_date = $2 AND slot_time = $3 AND status = 'available'
           ORDER BY id LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, slot_date, slot_time, hold_expires_at`,
      [phone, date, time, String(mins)],
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

export function isoDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}
