import { Router } from 'express'
import multer from 'multer'
import { query } from '../db.js'
import { config } from '../config.js'
import { releaseExpiredHolds } from '../lib/holds.js'
import { applyDripAll, DAY_SEATS, DAY_OPEN } from '../lib/drip.js'
import { isoDate } from './slots.js'
import { ah } from '../lib/ah.js'
import { setSetting, getSettings } from '../lib/settings.js'

export const adminRouter = Router()

// Files are stored IN the database (media table), so multer keeps them in memory
// just long enough to insert the bytes. (Heavier on RAM for big videos.)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } })

// Save an uploaded file's bytes into the media table; returns its id.
async function storeMedia(kind, file) {
  const { rows } = await query(
    `INSERT INTO media (kind, mimetype, data) VALUES ($1, $2, $3) RETURNING id`,
    [kind, file.mimetype || 'application/octet-stream', file.buffer],
  )
  return rows[0].id
}

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

// Unmatched payments — captured money we couldn't tie to a lead. Ops reviews
// these; > 0 rows means someone paid but isn't booked.
adminRouter.get(
  '/unmatched-payments',
  ah(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, payment_id, order_id, amount, currency, payer_email, payer_phone,
              received_at, resolved
         FROM unmatched_payments
        WHERE resolved = false
        ORDER BY received_at DESC`,
    )
    res.json(rows)
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
    await applyDripAll()
    const { rows } = await query(`
      SELECT slot_date, slot_time,
             COUNT(*)                                   AS capacity,
             COUNT(*) FILTER (WHERE status='available') AS available,
             COUNT(*) FILTER (WHERE status='pending')   AS pending,
             COUNT(*) FILTER (WHERE status='confirmed') AS confirmed,
             COUNT(*) FILTER (WHERE status='blocked')   AS blocked,
             COUNT(*) FILTER (WHERE status='blocked' AND COALESCE(release_wave, 1) = 1) AS wave1,
             COUNT(*) FILTER (WHERE status='blocked' AND release_wave = 2)              AS wave2
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
        blocked: Number(r.blocked),
        wave1: Number(r.wave1),
        wave2: Number(r.wave2),
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

// Open a date. The day is topped up to DAY_SEATS seats spread evenly across
// the NEW times — DAY_OPEN of the day's seats are bookable right away, the
// rest are created 'blocked' (shown as booked; released by the payment drip).
adminRouter.post(
  '/slots',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const times = Array.isArray(req.body?.times) ? req.body.times : []
    if (!date || !times.length) return res.status(400).json({ error: 'date and times[] required' })
    if (times.length > 20) return res.status(400).json({ error: 'max 20 slots per day' })

    // Skip times already opened for this date.
    const newTimes = []
    for (const t of times) {
      const time = String(t)
      const { rows } = await query(
        `SELECT 1 FROM slots WHERE slot_date=$1 AND slot_time=$2 LIMIT 1`,
        [date, time],
      )
      if (!rows.length) newTimes.push(time)
    }
    if (!newTimes.length) return res.json({ ok: true, created: 0, blocked: 0 })

    const { rows: ex } = await query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='blocked') AS blocked
         FROM slots WHERE slot_date = $1`,
      [date],
    )
    const existing = Number(ex[0].total)
    const toCreate = Math.max(0, DAY_SEATS - existing)
    const blockedToCreate = Math.min(
      toCreate,
      Math.max(0, DAY_SEATS - DAY_OPEN - Number(ex[0].blocked)),
    )

    // Spread both the seats AND the blocked share proportionally over every
    // time, so the "already booked" slots look organic (each time partially
    // booked; with single-seat times they alternate through the day).
    // Blocked seats alternate between release wave 1 (opens after 5
    // payments) and wave 2 (after 10).
    const N = newTimes.length
    const per = (total, t) => Math.floor(((t + 1) * total) / N) - Math.floor((t * total) / N)
    let blockedSoFar = 0
    for (let t = 0; t < N; t++) {
      const seatsHere = per(toCreate, t)
      const blockedHere = Math.min(seatsHere, per(blockedToCreate, t))
      for (let k = 0; k < seatsHere; k++) {
        const blocked = k >= seatsHere - blockedHere
        const wave = blocked ? (blockedSoFar++ % 2) + 1 : null
        await query(
          `INSERT INTO slots (slot_date, slot_time, status, release_wave) VALUES ($1, $2, $3, $4)`,
          [date, newTimes[t], blocked ? 'blocked' : 'available', wave],
        )
      }
    }
    res.json({ ok: true, created: toCreate, blocked: blockedToCreate })
  }),
)

// Move one blocked seat at (date,time) to the given release wave (1 or 2).
adminRouter.post(
  '/slots/wave',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const wave = Number(req.body?.wave) === 2 ? 2 : 1
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rowCount } = await query(
      `UPDATE slots SET release_wave = $3
        WHERE id = (SELECT id FROM slots
                     WHERE slot_date = $1 AND slot_time = $2 AND status = 'blocked'
                       AND COALESCE(release_wave, 1) <> $3
                     ORDER BY id LIMIT 1)
        RETURNING id`,
      [date, time, wave],
    )
    res.json({ ok: true, moved: rowCount })
  }),
)

// Block one available seat at (date,time) into a release wave (fake-book it).
adminRouter.post(
  '/slots/block',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const wave = Number(req.body?.wave) === 2 ? 2 : 1
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rowCount } = await query(
      `UPDATE slots SET status = 'blocked', release_wave = $3
        WHERE id = (SELECT id FROM slots
                     WHERE slot_date = $1 AND slot_time = $2 AND status = 'available'
                     ORDER BY id LIMIT 1)
        RETURNING id`,
      [date, time, wave],
    )
    if (!rowCount) return res.status(409).json({ error: 'no open seat at that time' })
    res.json({ ok: true })
  }),
)

// Release one blocked seat at (date,time) for booking right now.
adminRouter.post(
  '/slots/unblock',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rowCount } = await query(
      `UPDATE slots SET status = 'available', release_wave = NULL
        WHERE id = (SELECT id FROM slots
                     WHERE slot_date = $1 AND slot_time = $2 AND status = 'blocked'
                     ORDER BY id LIMIT 1)
        RETURNING id`,
      [date, time],
    )
    if (!rowCount) return res.status(409).json({ error: 'no blocked seat at that time' })
    res.json({ ok: true })
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
    const s = await getSettings(['video_id', 'thumb_id', 'reveal_seconds'])
    res.json({
      videoId: s.video_id ? Number(s.video_id) : null,
      thumbId: s.thumb_id ? Number(s.thumb_id) : null,
      revealSeconds: s.reveal_seconds != null ? Number(s.reveal_seconds) : 900,
    })
  }),
)

// Save config — optional video/thumbnail (stored in DB) + the reveal time.
adminRouter.post(
  '/config',
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  ah(async (req, res) => {
    if (req.files?.video?.[0]) {
      const id = await storeMedia('video', req.files.video[0])
      await setSetting('video_id', id)
    }
    if (req.files?.thumb?.[0]) {
      const id = await storeMedia('thumb', req.files.thumb[0])
      await setSetting('thumb_id', id)
    }
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
    imageUrl: r.image_id ? `/media/${r.image_id}` : r.image_file ? `/uploads/${r.image_file}` : null,
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
    const imageId = req.file ? await storeMedia('report', req.file) : null
    const { rows } = await query(
      `INSERT INTO testimonials (name, body, stat_before, stat_after, stat_text, today, image_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE((SELECT MAX(sort_order)+1 FROM testimonials), 0))
       RETURNING *`,
      [
        name,
        b.body || null,
        b.statBefore || null,
        b.statAfter || null,
        b.statText || null,
        b.today || null,
        imageId,
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
