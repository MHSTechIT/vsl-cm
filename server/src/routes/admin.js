import { Router } from 'express'
import multer from 'multer'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { query } from '../db.js'
import { config } from '../config.js'
import { releaseExpiredHolds } from '../lib/holds.js'
import { isoDate } from './slots.js'
import { ah } from '../lib/ah.js'
import { setSetting, getSettings } from '../lib/settings.js'

export const adminRouter = Router()

// uploads/ lives at the server root; index.js serves it statically at /uploads
export const uploadsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads')
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const stamp = Date.now()
    cb(null, `${file.fieldname}_${stamp}${extname(file.originalname) || ''}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }) // 1GB

// Simple shared-token auth for the whole admin API.
adminRouter.use((req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (token !== config.adminToken) return res.status(401).json({ error: 'unauthorized' })
  next()
})

// Dashboard: counts, funnel, watch-time breakdown.
adminRouter.get(
  '/stats',
  ah(async (_req, res) => {
    const { rows } = await query(`
      SELECT
        COUNT(*)                                AS registered,
        COUNT(*) FILTER (WHERE hit_25)          AS w25,
        COUNT(*) FILTER (WHERE hit_8min)        AS w8,
        COUNT(*) FILTER (WHERE hit_15min)       AS w15,
        COUNT(*) FILTER (WHERE finished)        AS wfin,
        COUNT(*) FILTER (WHERE form2_submitted) AS form2,
        COUNT(*) FILTER (WHERE paid)            AS paid
      FROM leads
    `)
    const r = rows[0]
    res.json({
      registered: Number(r.registered),
      watch: { p25: Number(r.w25), m8: Number(r.w8), m15: Number(r.w15), finished: Number(r.wfin) },
      form2: Number(r.form2),
      paid: Number(r.paid),
    })
  }),
)

// CRM table — all leads, newest first.
adminRouter.get(
  '/leads',
  ah(async (_req, res) => {
    const { rows } = await query(
      `SELECT phone, name, registered_at, watch_percent, hit_15min,
              form2_submitted, slot_date, slot_time, slot_status, paid, paid_at, needs_wa
         FROM leads
        ORDER BY registered_at DESC`,
    )
    res.json(rows.map((r) => ({ ...r, slot_date: r.slot_date ? isoDate(r.slot_date) : null })))
  }),
)

// Clear a lead's WhatsApp flag (after the team sends it manually).
adminRouter.post(
  '/leads/:phone/wa-sent',
  ah(async (req, res) => {
    const phone = String(req.params.phone).replace(/\D/g, '')
    await query(
      `UPDATE leads SET needs_wa = NULL, wa_sent_at = now(), updated_at = now() WHERE phone = $1`,
      [phone],
    )
    res.json({ ok: true })
  }),
)

// Slot management — time slots grouped by date, each with seat counts.
adminRouter.get(
  '/slots',
  ah(async (_req, res) => {
    await releaseExpiredHolds()
    const { rows } = await query(`
      SELECT slot_date, slot_time,
             COUNT(*)                                   AS capacity,
             COUNT(*) FILTER (WHERE status='available') AS available,
             COUNT(*) FILTER (WHERE status='pending')   AS pending,
             COUNT(*) FILTER (WHERE status='confirmed') AS confirmed
        FROM slots
       GROUP BY slot_date, slot_time
       ORDER BY slot_date, MIN(id)
    `)
    const byDate = new Map()
    for (const r of rows) {
      const d = isoDate(r.slot_date)
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d).push({
        time: r.slot_time,
        capacity: Number(r.capacity),
        available: Number(r.available),
        pending: Number(r.pending),
        confirmed: Number(r.confirmed),
      })
    }
    res.json([...byDate.entries()].map(([date, slots]) => ({ date, slots })))
  }),
)

// Set total seats for a (date,time). Adds available seats or trims spare ones
// (never below already pending/confirmed bookings).
adminRouter.post(
  '/slots/seats',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const seats = Math.max(1, Math.min(50, Math.round(Number(req.body?.seats) || 0)))
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })

    const { rows } = await query(
      `SELECT
         COUNT(*)                                       AS total,
         COUNT(*) FILTER (WHERE status='available')     AS available,
         COUNT(*) FILTER (WHERE status<>'available')    AS locked
       FROM slots WHERE slot_date=$1 AND slot_time=$2`,
      [date, time],
    )
    const total = Number(rows[0].total)
    const available = Number(rows[0].available)
    const locked = Number(rows[0].locked)
    const target = Math.max(seats, locked) // can't drop below booked/held seats

    if (target > total) {
      const add = target - total
      for (let i = 0; i < add; i++) {
        await query(`INSERT INTO slots (slot_date, slot_time) VALUES ($1, $2)`, [date, time])
      }
    } else if (target < total) {
      const remove = Math.min(total - target, available)
      await query(
        `DELETE FROM slots WHERE id IN (
           SELECT id FROM slots WHERE slot_date=$1 AND slot_time=$2 AND status='available'
           ORDER BY id DESC LIMIT $3)`,
        [date, time, remove],
      )
    }
    res.json({ ok: true, seats: target })
  }),
)

// Remove a whole time slot (all non-confirmed seats for that date+time).
adminRouter.post(
  '/slots/remove',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rowCount } = await query(
      `DELETE FROM slots WHERE slot_date=$1 AND slot_time=$2 AND status<>'confirmed'`,
      [date, time],
    )
    res.json({ ok: true, removed: rowCount })
  }),
)

// Open a date: create slots for a list of times (skips existing).
adminRouter.post(
  '/slots',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const times = Array.isArray(req.body?.times) ? req.body.times : []
    if (!date || !times.length) return res.status(400).json({ error: 'date and times[] required' })
    if (times.length > 20) return res.status(400).json({ error: 'max 20 slots per day' })

    // Create one seat per NEW time (skip times already opened for this date).
    let created = 0
    for (const t of times) {
      const time = String(t)
      const { rows } = await query(
        `SELECT 1 FROM slots WHERE slot_date=$1 AND slot_time=$2 LIMIT 1`,
        [date, time],
      )
      if (!rows.length) {
        await query(`INSERT INTO slots (slot_date, slot_time) VALUES ($1, $2)`, [date, time])
        created++
      }
    }
    res.json({ ok: true, created })
  }),
)

// Close a date: remove slots that aren't confirmed.
adminRouter.post(
  '/slots/close',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    if (!date) return res.status(400).json({ error: 'date required' })
    const { rowCount } = await query(
      `DELETE FROM slots WHERE slot_date = $1 AND status <> 'confirmed'`,
      [date],
    )
    res.json({ ok: true, removed: rowCount })
  }),
)

// Landing-page config: current video + thumbnail + booking-reveal time.
adminRouter.get(
  '/config',
  ah(async (_req, res) => {
    const s = await getSettings(['video_file', 'thumb_file', 'reveal_seconds'])
    res.json({
      videoFile: s.video_file || null,
      thumbFile: s.thumb_file || null,
      revealSeconds: s.reveal_seconds != null ? Number(s.reveal_seconds) : 900,
    })
  }),
)

// Save config — optional video/thumbnail files + the reveal time (multipart).
adminRouter.post(
  '/config',
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  ah(async (req, res) => {
    if (req.files?.video?.[0]) await setSetting('video_file', req.files.video[0].filename)
    if (req.files?.thumb?.[0]) await setSetting('thumb_file', req.files.thumb[0].filename)
    if (req.body?.revealSeconds != null && req.body.revealSeconds !== '') {
      const secs = Math.max(0, Math.round(Number(req.body.revealSeconds)) || 0)
      await setSetting('reveal_seconds', secs)
    }
    res.json({ ok: true })
  }),
)

// ---- Testimonials (proof cards) ----
function mapTestimonial(r) {
  return {
    id: r.id,
    name: r.name,
    body: r.body,
    statBefore: r.stat_before,
    statAfter: r.stat_after,
    statText: r.stat_text,
    today: r.today,
    imageUrl: r.image_file ? `/uploads/${r.image_file}` : null,
  }
}

adminRouter.get(
  '/testimonials',
  ah(async (_req, res) => {
    const { rows } = await query(`SELECT * FROM testimonials ORDER BY sort_order, id`)
    res.json(rows.map(mapTestimonial))
  }),
)

adminRouter.post(
  '/testimonials',
  upload.single('image'),
  ah(async (req, res) => {
    const b = req.body || {}
    const name = String(b.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name is required' })
    const { rows } = await query(
      `INSERT INTO testimonials (name, body, stat_before, stat_after, stat_text, today, image_file, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE((SELECT MAX(sort_order)+1 FROM testimonials), 0))
       RETURNING *`,
      [
        name,
        b.body || null,
        b.statBefore || null,
        b.statAfter || null,
        b.statText || null,
        b.today || null,
        req.file?.filename || null,
      ],
    )
    res.json(mapTestimonial(rows[0]))
  }),
)

adminRouter.delete(
  '/testimonials/:id',
  ah(async (req, res) => {
    await query(`DELETE FROM testimonials WHERE id = $1`, [Number(req.params.id)])
    res.json({ ok: true })
  }),
)

// Read-only settings surfaced to the admin UI.
adminRouter.get('/settings', (_req, res) => {
  res.json({
    holdWindowMinutes: config.holdWindowMinutes,
    razorpayMode: config.razorpay.mode,
    whapiConnected: Boolean(config.whapi.token),
  })
})
