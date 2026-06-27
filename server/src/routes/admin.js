import crypto from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { query } from '../db.js'
import { config } from '../config.js'
import { releaseExpiredHolds } from '../lib/holds.js'
import { applyDripAll, applySlotDrip } from '../lib/drip.js'
import { isoDate, isPastSlot, slotStartEpoch } from './slots.js'
import { ah } from '../lib/ah.js'
import { setSetting, getSettings } from '../lib/settings.js'
import { parseFunnel } from '../lib/funnel.js'
import { syncLeadsToSheet, spreadsheetIdFromUrl, isConfigured as googleConfigured } from '../lib/google-sheets.js'
import { sendSessionMessage, watiConfigured, watiPaymentSuccess } from '../lib/wati.js'
import { sendWhatsApp, confirmationMessage } from '../lib/whapi.js'
import { paymentContact, orderPaymentContact } from '../lib/razorpay.js'

export const adminRouter = Router()

// Which funnel the admin is viewing. The admin client sends ?funnel=paid|free
// on every request; leads / slots / content / testimonials are scoped to it.
const funnelOf = (req) => parseFunnel(req.query?.funnel)

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

// Staff session token = "staff.<id>.<hmac>" signed with the admin token.
function staffToken(id) {
  const body = `staff.${id}`
  const sig = crypto.createHmac('sha256', config.adminToken).update(body).digest('hex').slice(0, 32)
  return `${body}.${sig}`
}
function verifyStaffToken(token) {
  const m = /^staff\.(\d+)\.([a-f0-9]{32})$/.exec(token || '')
  if (!m) return null
  const expected = crypto.createHmac('sha256', config.adminToken).update(`staff.${m[1]}`).digest('hex').slice(0, 32)
  return m[2] === expected ? { id: Number(m[1]) } : null
}

// Staff login (phone + password) — mounted publicly in index.js, before auth.
export async function staffLogin(req, res) {
  const phone = String(req.body?.phone || '').replace(/\D/g, '')
  const password = String(req.body?.password || '')
  if (!phone || !password) return res.status(400).json({ error: 'phone and password required' })
  const { rows } = await query(
    `SELECT id, name, phone, pass_salt, pass_hash FROM users WHERE phone = $1`,
    [phone],
  )
  const u = rows[0]
  if (!u) return res.status(401).json({ error: 'invalid phone or password' })
  const hash = crypto.scryptSync(password, u.pass_salt, 64).toString('hex')
  if (hash !== u.pass_hash) return res.status(401).json({ error: 'invalid phone or password' })
  res.json({ token: staffToken(u.id), role: 'staff', name: u.name, phone: u.phone })
}

// Auth: super-admin shared token (full access) OR a signed staff token.
adminRouter.use((req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (token === config.adminToken) { req.role = 'admin'; return next() }
  const staff = verifyStaffToken(token)
  if (staff) { req.role = 'staff'; req.userId = staff.id; return next() }
  return res.status(401).json({ error: 'unauthorized' })
})

// Staff are scoped to the Leads + WATI pages only.
const STAFF_ALLOW = [/^\/me$/, /^\/leads$/, /^\/leads\/[^/]+\/hc$/, /^\/leads\/[^/]+\/converted$/, /^\/wa\//]
adminRouter.use((req, res, next) => {
  if (req.role !== 'staff') return next()
  if (STAFF_ALLOW.some((rx) => rx.test(req.path))) return next()
  return res.status(403).json({ error: 'forbidden' })
})

// Who am I — drives the shell's nav + auth check.
adminRouter.get(
  '/me',
  ah(async (req, res) => {
    if (req.role === 'admin') return res.json({ role: 'admin' })
    const { rows } = await query(`SELECT name, phone FROM users WHERE id = $1`, [req.userId])
    res.json({ role: 'staff', name: rows[0]?.name || '', phone: rows[0]?.phone || '' })
  }),
)

// Dashboard: counts, funnel, watch-time breakdown.
adminRouter.get(
  '/stats',
  ah(async (req, res) => {
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
      WHERE funnel = $1
    `, [funnelOf(req)])
    const r = rows[0]
    res.json({
      registered: Number(r.registered),
      watch: { p25: Number(r.w25), m8: Number(r.w8), m15: Number(r.w15), finished: Number(r.wfin) },
      form2: Number(r.form2),
      paid: Number(r.paid),
    })
  }),
)

// Resolve missing "Pay phone" values from Razorpay (the contact the customer
// typed during payment). Runs lazily after each Leads load, a few at a time,
// so older payments backfill without blocking the response. Live keys only.
async function backfillPayPhones(rows) {
  try {
    const missing = rows
      .filter((r) => r.paid && !r.payment_phone && (r.rzp_payment_id || r.rzp_order_id))
      .slice(0, 5)
    for (const r of missing) {
      let contact = r.rzp_payment_id ? await paymentContact(r.rzp_payment_id) : null
      if (!contact && r.rzp_order_id) contact = await orderPaymentContact(r.rzp_order_id)
      if (contact) {
        await query(`UPDATE leads SET payment_phone = $2, updated_at = now() WHERE phone = $1`, [
          r.phone,
          String(contact).replace(/\D/g, ''),
        ])
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[leads] pay-phone backfill:', e.message)
  }
}

// CRM table — all leads, newest first.
adminRouter.get(
  '/leads',
  ah(async (req, res) => {
    // funnel=all → both funnels (no filter); otherwise scope to one.
    const all = String(req.query?.funnel || '').toLowerCase() === 'all'
    const { rows } = await query(
      `SELECT phone, name, registered_at, watch_percent, form2_submitted,
              slot_date, slot_time, slot_status, paid, paid_at, needs_wa,
              payment_phone, payment_status, wa_payment, wa_1h_sent, hc_status, hc_data,
              converted,
              rzp_payment_id, rzp_order_id, source, source_detail, funnel
         FROM leads
        ${all ? '' : 'WHERE funnel = $1'}
        ORDER BY GREATEST(registered_at, COALESCE(paid_at, registered_at)) DESC`,
      all ? [] : [funnelOf(req)],
    )
    res.json(rows.map((r) => ({ ...r, slot_date: r.slot_date ? isoDate(r.slot_date) : null })))
    backfillPayPhones(rows) // fire-and-forget — next refresh shows the numbers
  }),
)

// Bulk-delete leads by phone. Frees any seats they hold/own (back to available)
// so capacity isn't lost, then removes the lead rows.
adminRouter.post(
  '/leads/delete',
  ah(async (req, res) => {
    const phones = Array.isArray(req.body?.phones)
      ? [...new Set(req.body.phones.map((p) => String(p).replace(/\D/g, '')).filter(Boolean))]
      : []
    if (!phones.length) return res.status(400).json({ error: 'phones[] required' })
    await query(
      `UPDATE slots
          SET status = 'available', lead_phone = NULL, held_by_phone = NULL,
              hold_expires_at = NULL, manual = false
        WHERE lead_phone = ANY($1) OR held_by_phone = ANY($1)`,
      [phones],
    )
    const { rowCount } = await query(`DELETE FROM leads WHERE phone = ANY($1)`, [phones])
    res.json({ ok: true, deleted: rowCount })
  }),
)

// Payments log — every confirmed transaction (repeat payments from the same
// phone are separate rows). Newest first.
adminRouter.get(
  '/payments',
  ah(async (_req, res) => {
    const { rows } = await query(
      `SELECT payment_id, order_id, phone, name, amount, currency, created_at
         FROM payments
        ORDER BY created_at DESC
        LIMIT 2000`,
    )
    res.json(rows)
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

// ---- Staff accounts (admin Users page) ----
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex')
  return { salt, hash }
}

adminRouter.get(
  '/users',
  ah(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, name, phone, created_at FROM users ORDER BY created_at DESC`,
    )
    res.json(rows)
  }),
)

adminRouter.post(
  '/users',
  ah(async (req, res) => {
    const name = String(req.body?.name || '').trim()
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    const password = String(req.body?.password || '')
    if (!name) return res.status(400).json({ error: 'name is required' })
    if (phone.length < 8) return res.status(400).json({ error: 'a valid phone number is required' })
    if (password.length < 4) return res.status(400).json({ error: 'password must be at least 4 characters' })

    const { salt, hash } = hashPassword(password)
    try {
      const { rows } = await query(
        `INSERT INTO users (name, phone, pass_salt, pass_hash) VALUES ($1, $2, $3, $4)
         RETURNING id, name, phone, created_at`,
        [name, phone, salt, hash],
      )
      res.json(rows[0])
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'an account with that phone already exists' })
      throw e
    }
  }),
)

adminRouter.put(
  '/users/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id)
    const name = String(req.body?.name || '').trim()
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    const password = String(req.body?.password || '')
    if (!name) return res.status(400).json({ error: 'name is required' })
    if (phone.length < 8) return res.status(400).json({ error: 'a valid phone number is required' })
    if (password && password.length < 4) {
      return res.status(400).json({ error: 'password must be at least 4 characters' })
    }
    try {
      if (password) {
        const { salt, hash } = hashPassword(password)
        await query(
          `UPDATE users SET name = $2, phone = $3, pass_salt = $4, pass_hash = $5 WHERE id = $1`,
          [id, name, phone, salt, hash],
        )
      } else {
        await query(`UPDATE users SET name = $2, phone = $3 WHERE id = $1`, [id, name, phone])
      }
      const { rows } = await query(`SELECT id, name, phone, created_at FROM users WHERE id = $1`, [id])
      res.json(rows[0] || { ok: true })
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'an account with that phone already exists' })
      throw e
    }
  }),
)

adminRouter.delete(
  '/users/:id',
  ah(async (req, res) => {
    await query(`DELETE FROM users WHERE id = $1`, [Number(req.params.id)])
    res.json({ ok: true })
  }),
)

// Save a lead's health-check form (HC). Updates name + the JSON detail.
adminRouter.post(
  '/leads/:phone/hc',
  ah(async (req, res) => {
    const phone = String(req.params.phone).replace(/\D/g, '')
    const b = req.body || {}
    const name = String(b.name || '').trim()
    const hc = {
      sugar_level: String(b.sugar_level || ''),
      age: String(b.age || ''),
      gender: String(b.gender || ''),
      l1_detox: String(b.l1_detox || ''),
      professional: String(b.professional || ''),
      location: String(b.location || ''),
      app_datetime: String(b.app_datetime || ''),
      other_issues: String(b.other_issues || ''),
    }
    await query(
      `UPDATE leads
          SET name = COALESCE(NULLIF($2, ''), name),
              hc_data = $3::jsonb, hc_status = 'done', updated_at = now()
        WHERE phone = $1`,
      [phone, name, JSON.stringify(hc)],
    )
    res.json({ ok: true })
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

// Toggle a lead's "converted" flag (enrolled/closed) from the CRM table.
adminRouter.post(
  '/leads/:phone/converted',
  ah(async (req, res) => {
    const phone = String(req.params.phone).replace(/\D/g, '')
    const converted = Boolean(req.body?.converted)
    await query(
      `UPDATE leads SET converted = $2, updated_at = now() WHERE phone = $1`,
      [phone, converted],
    )
    res.json({ ok: true, converted })
  }),
)

// Slot management — time slots grouped by date, each with seat counts.
adminRouter.get(
  '/slots',
  ah(async (req, res) => {
    // funnel=all → both funnels (date cards tagged); otherwise scope to one.
    const all = String(req.query?.funnel || '').toLowerCase() === 'all'
    const funnel = funnelOf(req)
    await releaseExpiredHolds()
    await applyDripAll()
    const { rows } = await query(`
      SELECT slot_date, slot_time, funnel,
             COUNT(*)                                   AS capacity,
             COUNT(*) FILTER (WHERE status='available') AS available,
             COUNT(*) FILTER (WHERE status='pending')   AS pending,
             COUNT(*) FILTER (WHERE status='confirmed') AS confirmed,
             COUNT(*) FILTER (WHERE status='blocked')   AS blocked,
             COUNT(*) FILTER (WHERE status='permanent') AS permanent,
             COUNT(*) FILTER (WHERE status='blocked' AND COALESCE(release_wave, 1) = 1) AS wave1,
             COUNT(*) FILTER (WHERE status='blocked' AND release_wave = 2)              AS wave2
        FROM slots
       ${all ? '' : 'WHERE funnel = $1'}
       GROUP BY slot_date, slot_time, funnel
       ORDER BY slot_date, MIN(id)
    `, all ? [] : [funnel])
    const nowMs = Date.now()
    // per-date publish state (missing row = active)
    const { rows: dayRows } = await query(
      `SELECT slot_date, active, funnel FROM slot_days ${all ? '' : 'WHERE funnel = $1'}`,
      all ? [] : [funnel],
    )
    const activeMap = new Map(dayRows.map((r) => [`${r.funnel}|${isoDate(r.slot_date)}`, r.active]))
    // Group by (funnel, date) so an "all" view shows one card per funnel per date.
    const byKey = new Map()
    for (const r of rows) {
      const d = isoDate(r.slot_date)
      const key = `${r.funnel}|${d}`
      if (!byKey.has(key)) byKey.set(key, { date: d, funnel: r.funnel, slots: [] })
      byKey.get(key).slots.push({
        time: r.slot_time,
        capacity: Number(r.capacity),
        available: Number(r.available),
        pending: Number(r.pending),
        confirmed: Number(r.confirmed),
        blocked: Number(r.blocked),
        permanent: Number(r.permanent),
        wave1: Number(r.wave1),
        wave2: Number(r.wave2),
        past: isPastSlot(d, r.slot_time, nowMs), // start time passed (IST) → auto-closed
      })
    }
    // Sort each day's slots by their actual start time (chronological), not by
    // creation order — so a slot added later (e.g. 11am) still shows first.
    res.json(
      [...byKey.values()].map((g) => ({
        date: g.date,
        funnel: g.funnel,
        active: activeMap.has(`${g.funnel}|${g.date}`) ? activeMap.get(`${g.funnel}|${g.date}`) : true,
        slots: g.slots.sort(
          (a, b) => (slotStartEpoch(g.date, a.time) ?? 0) - (slotStartEpoch(g.date, b.time) ?? 0),
        ),
      })),
    )
  }),
)

// Publish toggle for a whole date. active=false hides it from the public
// booking calendar; the admin still manages its slots.
adminRouter.post(
  '/slots/date/active',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const active = Boolean(req.body?.active)
    const funnel = funnelOf(req)
    if (!date) return res.status(400).json({ error: 'date required' })
    await query(
      `INSERT INTO slot_days (slot_date, funnel, active) VALUES ($1, $3, $2)
       ON CONFLICT (slot_date, funnel) DO UPDATE SET active = $2`,
      [date, active, funnel],
    )
    res.json({ ok: true, active })
  }),
)

// Set total seats for a (date,time). Adds available seats or trims spare ones
// (never below already pending/confirmed bookings).
adminRouter.post(
  '/slots/seats',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const funnel = funnelOf(req)
    const seats = Math.max(0, Math.min(50, Math.round(Number(req.body?.seats) || 0)))
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })

    // 0 = permanently booked: every open/blocked seat becomes 'permanent'
    // (shown booked forever, never released by the payment drip).
    if (seats === 0) {
      await query(
        `UPDATE slots SET status = 'permanent', release_wave = NULL
          WHERE slot_date = $1 AND slot_time = $2 AND funnel = $3 AND status IN ('available', 'blocked')`,
        [date, time, funnel],
      )
      return res.json({ ok: true, seats: 0, permanent: true })
    }

    // any positive number first releases permanent seats back to available
    await query(
      `UPDATE slots SET status = 'available'
        WHERE slot_date = $1 AND slot_time = $2 AND funnel = $3 AND status = 'permanent'`,
      [date, time, funnel],
    )

    const { rows } = await query(
      `SELECT
         COUNT(*)                                       AS total,
         COUNT(*) FILTER (WHERE status='available')     AS available,
         COUNT(*) FILTER (WHERE status<>'available')    AS locked
       FROM slots WHERE slot_date=$1 AND slot_time=$2 AND funnel=$3`,
      [date, time, funnel],
    )
    const total = Number(rows[0].total)
    const available = Number(rows[0].available)
    const locked = Number(rows[0].locked)
    const target = Math.max(seats, locked) // can't drop below booked/held seats

    if (target > total) {
      const add = target - total
      for (let i = 0; i < add; i++) {
        await query(`INSERT INTO slots (slot_date, slot_time, funnel) VALUES ($1, $2, $3)`, [date, time, funnel])
      }
    } else if (target < total) {
      const remove = Math.min(total - target, available)
      await query(
        `DELETE FROM slots WHERE id IN (
           SELECT id FROM slots WHERE slot_date=$1 AND slot_time=$2 AND funnel=$3 AND status='available'
           ORDER BY id DESC LIMIT $4)`,
        [date, time, funnel, remove],
      )
    }
    res.json({ ok: true, seats: target })
  }),
)

// List every seat for a (date,time) with its occupant — powers the per-seat
// editor. `locked` marks a real (Razorpay-paid) booking that must not be touched.
adminRouter.get(
  '/slots/seats',
  ah(async (req, res) => {
    const date = String(req.query?.date || '')
    const time = String(req.query?.time || '')
    const funnel = funnelOf(req)
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rows } = await query(
      `SELECT s.id, s.status, s.lead_phone, s.manual, l.name AS lead_name
         FROM slots s
         LEFT JOIN leads l ON l.phone = s.lead_phone
        WHERE s.slot_date = $1 AND s.slot_time = $2 AND s.funnel = $3
        ORDER BY s.id`,
      [date, time, funnel],
    )
    res.json(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        leadPhone: r.lead_phone,
        leadName: r.lead_name,
        manual: r.manual,
        locked: r.status === 'confirmed' && !r.manual, // real paid booking
      })),
    )
  }),
)

// Add one empty seat to a (date,time). Capped at the template's seats-per-slot:
// you can't create more seats than "Seats per slot" allows.
adminRouter.post(
  '/slots/seat/add',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const funnel = funnelOf(req)
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const tpl = await getSettings(['slot_template_seats'], funnel)
    const maxSeats = Math.max(1, Math.min(20, parseInt(tpl.slot_template_seats, 10) || 1))
    const { rows: cnt } = await query(
      `SELECT COUNT(*) AS n FROM slots WHERE slot_date = $1 AND slot_time = $2 AND funnel = $3`,
      [date, time, funnel],
    )
    if (Number(cnt[0].n) >= maxSeats) {
      return res
        .status(409)
        .json({ error: `max ${maxSeats} seat${maxSeats > 1 ? 's' : ''} per slot — raise "Seats per slot" in Template` })
    }
    const { rows } = await query(
      `INSERT INTO slots (slot_date, slot_time, funnel) VALUES ($1, $2, $3) RETURNING id`,
      [date, time, funnel],
    )
    res.json({ ok: true, id: rows[0].id })
  }),
)

// Manually assign a lead to a specific seat and mark it booked + paid (counts
// as a ₹50 booking). Sends the same confirmation WhatsApp a real payment does.
adminRouter.post(
  '/slots/seat/assign',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const seatId = Number(req.body?.seatId)
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    if (!date || !time || !Number.isFinite(seatId) || !phone)
      return res.status(400).json({ error: 'date, time, seatId, phone required' })

    const seatRows = await query(
      `SELECT id, status, manual FROM slots WHERE id = $1 AND slot_date = $2 AND slot_time = $3`,
      [seatId, date, time],
    )
    if (!seatRows.rows.length) return res.status(404).json({ error: 'seat not found' })
    if (seatRows.rows[0].status === 'confirmed' && !seatRows.rows[0].manual)
      return res.status(409).json({ error: 'that seat is a real paid booking' })

    const leadRows = await query(`SELECT phone, name FROM leads WHERE phone = $1`, [phone])
    if (!leadRows.rows.length) return res.status(404).json({ error: 'lead not found' })

    // Release any other manual seat this lead currently occupies (avoid dupes).
    await query(
      `UPDATE slots SET status = 'available', lead_phone = NULL, held_by_phone = NULL,
              hold_expires_at = NULL, manual = false
        WHERE lead_phone = $1 AND id <> $2 AND manual = true`,
      [phone, seatId],
    )
    // Claim this seat for the lead (flagged manual).
    await query(
      `UPDATE slots SET status = 'confirmed', lead_phone = $2, held_by_phone = NULL,
              hold_expires_at = NULL, manual = true
        WHERE id = $1`,
      [seatId, phone],
    )
    // Mark the lead booked + paid, flagged 'manual' in the payment status so the
    // Leads page distinguishes it from a real Razorpay payment.
    await query(
      `UPDATE leads
          SET slot_date = $2, slot_time = $3, slot_status = 'confirmed',
              paid = true, paid_at = COALESCE(paid_at, now()),
              payment_status = 'manual', wa_payment = 'success', updated_at = now()
        WHERE phone = $1`,
      [phone, date, time],
    )
    // Booking-confirmation WhatsApp (same path as a real payment).
    if (watiConfigured()) {
      watiPaymentSuccess(phone, { name: leadRows.rows[0].name }).catch((e) =>
        // eslint-disable-next-line no-console
        console.error('[wati] manual booking confirm failed:', e.message),
      )
    } else {
      sendWhatsApp(phone, confirmationMessage(date, time), 'confirmation').catch(() => {})
    }
    applySlotDrip(date).catch(() => {})
    res.json({ ok: true, name: leadRows.rows[0].name })
  }),
)

// Add a brand-new lead (name + phone only) and book it into a seat — no payment
// recorded. Everything else on the lead stays empty (paid/payment_status/etc.
// remain null). Used by the "+ Add lead" button in the seat picker.
adminRouter.post(
  '/slots/seat/add-lead',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const seatId = Number(req.body?.seatId)
    const name = String(req.body?.name || '').trim()
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    const funnel = funnelOf(req)
    if (!date || !time || !Number.isFinite(seatId) || !name || !phone)
      return res.status(400).json({ error: 'name, phone, date, time and seatId required' })

    const seatRows = await query(
      `SELECT id, status, manual FROM slots WHERE id = $1 AND slot_date = $2 AND slot_time = $3 AND funnel = $4`,
      [seatId, date, time, funnel],
    )
    if (!seatRows.rows.length) return res.status(404).json({ error: 'seat not found' })
    if (seatRows.rows[0].status === 'confirmed' && !seatRows.rows[0].manual)
      return res.status(409).json({ error: 'that seat is a real paid booking' })

    // Create (or reuse) the lead — only name + phone; all other fields stay empty.
    await query(
      `INSERT INTO leads (phone, name, funnel) VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [phone, name, funnel],
    )
    // Release any other manual seat this lead occupies (avoid dupes).
    await query(
      `UPDATE slots SET status = 'available', lead_phone = NULL, held_by_phone = NULL,
              hold_expires_at = NULL, manual = false
        WHERE lead_phone = $1 AND id <> $2 AND manual = true`,
      [phone, seatId],
    )
    // Book this seat for the lead (flagged manual; NO payment is recorded).
    await query(
      `UPDATE slots SET status = 'confirmed', lead_phone = $2, held_by_phone = NULL,
              hold_expires_at = NULL, manual = true
        WHERE id = $1`,
      [seatId, phone],
    )
    await query(
      `UPDATE leads SET slot_date = $2, slot_time = $3, slot_status = 'confirmed', updated_at = now()
        WHERE phone = $1`,
      [phone, date, time],
    )
    applySlotDrip(date).catch(() => {})
    res.json({ ok: true, name })
  }),
)

// Delete a seat (per-seat "del"). Empty/blocked/manual seats only — a real paid
// booking is protected. A manual booking also clears the lead's booking.
adminRouter.post(
  '/slots/seat/free',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const seatId = Number(req.body?.seatId)
    if (!date || !time || !Number.isFinite(seatId))
      return res.status(400).json({ error: 'date, time, seatId required' })

    const seatRows = await query(
      `SELECT id, status, manual, lead_phone FROM slots WHERE id = $1 AND slot_date = $2 AND slot_time = $3`,
      [seatId, date, time],
    )
    if (!seatRows.rows.length) return res.status(404).json({ error: 'seat not found' })
    const seat = seatRows.rows[0]
    if (seat.status === 'confirmed' && !seat.manual)
      return res.status(409).json({ error: 'cannot delete a real paid booking' })

    if (seat.status === 'confirmed' && seat.manual && seat.lead_phone) {
      await query(
        `UPDATE leads SET slot_status = NULL, paid = false, paid_at = NULL,
                payment_status = NULL, wa_payment = NULL, updated_at = now()
          WHERE phone = $1`,
        [seat.lead_phone],
      )
    }

    // If this is the LAST seat for the time, don't delete it outright — an empty
    // time would vanish from the grid. Instead lock it (keep a single
    // 'permanent' placeholder), so a time with no usable seats reads as locked.
    // Use the chip's × ("remove") control to delete the time entirely.
    const { rows: rest } = await query(
      `SELECT COUNT(*) AS n FROM slots WHERE slot_date = $1 AND slot_time = $2 AND funnel = $4 AND id <> $3`,
      [date, time, seatId, funnelOf(req)],
    )
    if (Number(rest[0].n) === 0) {
      await query(
        `UPDATE slots SET status = 'permanent', release_wave = NULL, lead_phone = NULL,
                held_by_phone = NULL, hold_expires_at = NULL, manual = false
          WHERE id = $1`,
        [seatId],
      )
      return res.json({ ok: true, locked: true })
    }

    await query(`DELETE FROM slots WHERE id = $1`, [seatId])
    res.json({ ok: true })
  }),
)

// Remove a whole time slot (all non-confirmed seats for that date+time).
adminRouter.post(
  '/slots/remove',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const funnel = funnelOf(req)
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rowCount } = await query(
      `DELETE FROM slots WHERE slot_date=$1 AND slot_time=$2 AND funnel=$3 AND status<>'confirmed'`,
      [date, time, funnel],
    )
    res.json({ ok: true, removed: rowCount })
  }),
)

// Open a date. Each NEW time gets `seatsPerSlot` bookable seats (template
// setting, default 1), all available — the admin controls scarcity manually
// via the per-slot editor / release cards.
adminRouter.post(
  '/slots',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const times = Array.isArray(req.body?.times) ? req.body.times : []
    const funnel = funnelOf(req)
    if (!date || !times.length) return res.status(400).json({ error: 'date and times[] required' })
    if (times.length > 20) return res.status(400).json({ error: 'max 20 slots per day' })

    // Skip times already opened for this date (in this funnel).
    const newTimes = []
    for (const t of times) {
      const time = String(t)
      const { rows } = await query(
        `SELECT 1 FROM slots WHERE slot_date=$1 AND slot_time=$2 AND funnel=$3 LIMIT 1`,
        [date, time, funnel],
      )
      if (!rows.length) newTimes.push(time)
    }
    if (!newTimes.length) return res.json({ ok: true, created: 0, blocked: 0 })

    // Template settings: how many bookable seats each NEW time gets (seats per
    // slot, default 1), and which times to lock by default. Each new time is
    // created with exactly `seatsPerSlot` available seats.
    const tpl = await getSettings(['slot_template_locked', 'slot_template_seats'], funnel)
    const seatsPerSlot = Math.max(1, Math.min(20, parseInt(tpl.slot_template_seats, 10) || 1))

    const N = newTimes.length
    let created = 0
    for (let t = 0; t < N; t++) {
      for (let k = 0; k < seatsPerSlot; k++) {
        await query(
          `INSERT INTO slots (slot_date, slot_time, status, funnel) VALUES ($1, $2, 'available', $3)`,
          [date, newTimes[t], funnel],
        )
        created++
      }
    }
    // Apply the saved template: lock (permanent) any of the day's times the
    // admin marked in the template, so new days start with those slots locked.
    let tplLocked = []
    try { tplLocked = JSON.parse(tpl.slot_template_locked || '[]') } catch { /* ignore */ }
    if (Array.isArray(tplLocked) && tplLocked.length) {
      await query(
        `UPDATE slots SET status = 'permanent', release_wave = NULL
          WHERE slot_date = $1 AND slot_time = ANY($2) AND funnel = $3 AND status IN ('available', 'blocked')`,
        [date, tplLocked, funnel],
      )
    }
    res.json({ ok: true, created, blocked: 0, seatsPerSlot })
  }),
)

// Slot template — which times are locked by default on a newly-opened day, and
// how many bookable seats each time gets (seats per slot).
adminRouter.get(
  '/slots/template',
  ah(async (req, res) => {
    const s = await getSettings(['slot_template_locked', 'slot_template_seats'], funnelOf(req))
    let locked = []
    try { locked = JSON.parse(s.slot_template_locked || '[]') } catch { /* ignore */ }
    const seats = Math.max(1, Math.min(20, parseInt(s.slot_template_seats, 10) || 1))
    res.json({ locked: Array.isArray(locked) ? locked : [], seats })
  }),
)
adminRouter.post(
  '/slots/template',
  ah(async (req, res) => {
    const funnel = funnelOf(req)
    const locked = Array.isArray(req.body?.locked) ? req.body.locked.map(String) : []
    const seats = Math.max(1, Math.min(20, parseInt(req.body?.seats, 10) || 1))
    await setSetting('slot_template_locked', JSON.stringify(locked), funnel)
    await setSetting('slot_template_seats', String(seats), funnel)
    res.json({ ok: true, locked, seats })
  }),
)

// Move one blocked seat at (date,time) to the given release wave (1 or 2).
adminRouter.post(
  '/slots/wave',
  ah(async (req, res) => {
    const date = String(req.body?.date || '')
    const time = String(req.body?.time || '')
    const funnel = funnelOf(req)
    const wave = Number(req.body?.wave) === 2 ? 2 : 1
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rowCount } = await query(
      `UPDATE slots SET release_wave = $3
        WHERE id = (SELECT id FROM slots
                     WHERE slot_date = $1 AND slot_time = $2 AND funnel = $4 AND status = 'blocked'
                       AND COALESCE(release_wave, 1) <> $3
                     ORDER BY id LIMIT 1)
        RETURNING id`,
      [date, time, wave, funnel],
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
    const funnel = funnelOf(req)
    const wave = Number(req.body?.wave) === 2 ? 2 : 1
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rowCount } = await query(
      `UPDATE slots SET status = 'blocked', release_wave = $3
        WHERE id = (SELECT id FROM slots
                     WHERE slot_date = $1 AND slot_time = $2 AND funnel = $4 AND status = 'available'
                     ORDER BY id LIMIT 1)
        RETURNING id`,
      [date, time, wave, funnel],
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
    const funnel = funnelOf(req)
    if (!date || !time) return res.status(400).json({ error: 'date and time required' })
    const { rowCount } = await query(
      `UPDATE slots SET status = 'available', release_wave = NULL
        WHERE id = (SELECT id FROM slots
                     WHERE slot_date = $1 AND slot_time = $2 AND funnel = $3 AND status = 'blocked'
                     ORDER BY id LIMIT 1)
        RETURNING id`,
      [date, time, funnel],
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
    const funnel = funnelOf(req)
    if (!date) return res.status(400).json({ error: 'date required' })
    const { rowCount } = await query(
      `DELETE FROM slots WHERE slot_date = $1 AND funnel = $2 AND status <> 'confirmed'`,
      [date, funnel],
    )
    res.json({ ok: true, removed: rowCount })
  }),
)

// Pull the numeric id out of a Vimeo URL (or accept a bare id).
function vimeoIdFrom(input) {
  const s = String(input || '').trim()
  if (!s) return ''
  if (/^\d+$/.test(s)) return s
  const m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  return m ? m[1] : ''
}

// Landing-page config: current video + thumbnail + booking-reveal time.
adminRouter.get(
  '/config',
  ah(async (req, res) => {
    const s = await getSettings(['video_id', 'thumb_id', 'reveal_seconds', 'vimeo_id'], funnelOf(req))
    res.json({
      videoId: s.video_id ? Number(s.video_id) : null,
      thumbId: s.thumb_id ? Number(s.thumb_id) : null,
      revealSeconds: s.reveal_seconds != null ? Number(s.reveal_seconds) : 900,
      vimeoId: s.vimeo_id || '',
    })
  }),
)

// Save config — optional video/thumbnail (stored in DB) + the reveal time.
// Replacing a video/thumbnail auto-deletes the previous one from the media
// table, so old files never pile up in the database.
adminRouter.post(
  '/config',
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  ah(async (req, res) => {
    const funnel = funnelOf(req)
    const prev = await getSettings(['video_id', 'thumb_id'], funnel)
    if (req.files?.video?.[0]) {
      const id = await storeMedia('video', req.files.video[0])
      await setSetting('video_id', id, funnel)
      const old = Number(prev.video_id)
      if (old && old !== id) {
        await query(`DELETE FROM media WHERE id = $1`, [old]).catch(() => {})
      }
    }
    if (req.files?.thumb?.[0]) {
      const id = await storeMedia('thumb', req.files.thumb[0])
      await setSetting('thumb_id', id, funnel)
      const old = Number(prev.thumb_id)
      if (old && old !== id) {
        await query(`DELETE FROM media WHERE id = $1`, [old]).catch(() => {})
      }
    }
    if (req.body?.revealSeconds != null && req.body.revealSeconds !== '') {
      const secs = Math.max(0, Math.round(Number(req.body.revealSeconds)) || 0)
      await setSetting('reveal_seconds', secs, funnel)
    }
    // Vimeo link — when set, the landing page plays from Vimeo instead of the
    // DB-stored file. Pass an empty string to clear it (back to the DB video).
    if (req.body?.vimeoUrl != null) {
      await setSetting('vimeo_id', vimeoIdFrom(req.body.vimeoUrl), funnel)
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
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM testimonials WHERE funnel = $1 ORDER BY sort_order, id`,
      [funnelOf(req)],
    )
    res.json(rows.map(mapTestimonial))
  }),
)

adminRouter.post(
  '/testimonials',
  upload.single('image'),
  ah(async (req, res) => {
    const b = req.body || {}
    const funnel = funnelOf(req)
    const name = String(b.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name is required' })
    const imageId = req.file ? await storeMedia('report', req.file) : null
    const { rows } = await query(
      `INSERT INTO testimonials (name, body, stat_before, stat_after, stat_text, today, image_id, funnel, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE((SELECT MAX(sort_order)+1 FROM testimonials WHERE funnel=$8), 0))
       RETURNING *`,
      [
        name,
        b.body || null,
        b.statBefore || null,
        b.statAfter || null,
        b.statText || null,
        b.today || null,
        imageId,
        funnel,
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

// ---- WATI inbox (WhatsApp-web-style chat) ----
// Conversation list: latest message per customer number, newest first.
adminRouter.get(
  '/wa/conversations',
  ah(async (_req, res) => {
    // Only conversations with numbers we generated as leads in this app —
    // matched on the last 10 digits (lead phones are stored without the 91).
    const { rows } = await query(
      `SELECT t.wa_id, COALESCE(l.name, t.name) AS name, t.text, t.direction, t.created_at,
              (SELECT COUNT(*) FROM wa_messages m
                WHERE m.wa_id = t.wa_id AND m.direction = 'in'
                  AND m.created_at > COALESCE(rd.read_at, 'epoch'::timestamptz)) AS unread
         FROM (
           SELECT DISTINCT ON (wa_id) wa_id, name, text, direction, created_at
             FROM wa_messages ORDER BY wa_id, created_at DESC
         ) t
         JOIN leads l
           ON right(regexp_replace(l.phone, '\\D', '', 'g'), 10) = right(t.wa_id, 10)
         LEFT JOIN wa_reads rd ON rd.wa_id = t.wa_id
        ORDER BY t.created_at DESC`,
    )
    res.json({
      watiConfigured: watiConfigured(),
      conversations: rows.map((r) => ({ ...r, unread: Number(r.unread) })),
    })
  }),
)

// Mark a conversation read (clears its unread badge).
adminRouter.post(
  '/wa/read/:waId',
  ah(async (req, res) => {
    const waId = String(req.params.waId).replace(/\D/g, '')
    if (!waId) return res.status(400).json({ error: 'waId required' })
    await query(
      `INSERT INTO wa_reads (wa_id, read_at) VALUES ($1, now())
       ON CONFLICT (wa_id) DO UPDATE SET read_at = now()`,
      [waId],
    )
    res.json({ ok: true })
  }),
)

// Full thread for one number.
adminRouter.get(
  '/wa/messages/:waId',
  ah(async (req, res) => {
    const waId = String(req.params.waId).replace(/\D/g, '')
    const { rows } = await query(
      `SELECT id, name, direction, text, type, created_at
         FROM wa_messages WHERE wa_id = $1 ORDER BY created_at`,
      [waId],
    )
    res.json(rows)
  }),
)

// Send a reply (session message) and store it as outgoing.
adminRouter.post(
  '/wa/send',
  ah(async (req, res) => {
    const waId = String(req.body?.waId || '').replace(/\D/g, '')
    const text = String(req.body?.text || '').trim()
    if (!waId || !text) return res.status(400).json({ error: 'waId and text required' })
    try {
      await sendSessionMessage(waId, text)
      const { rows } = await query(
        `INSERT INTO wa_messages (wa_id, direction, text, type) VALUES ($1, 'out', $2, 'text')
         RETURNING id, direction, text, created_at`,
        [waId, text],
      )
      res.json({ ok: true, message: rows[0] })
    } catch (e) {
      res.status(502).json({ error: e.message })
    }
  }),
)

// ---- Google Sheets export ----
adminRouter.get(
  '/sheets',
  ah(async (_req, res) => {
    const s = await getSettings(['sheets_url', 'sheets_last_sync'])
    res.json({
      googleConfigured: googleConfigured(),
      url: s.sheets_url || '',
      linked: Boolean(spreadsheetIdFromUrl(s.sheets_url)),
      lastSync: s.sheets_last_sync || null,
    })
  }),
)

// Save the sheet link, then immediately push the current leads into it.
adminRouter.post(
  '/sheets',
  ah(async (req, res) => {
    const url = String(req.body?.url || '').trim()
    if (url && !spreadsheetIdFromUrl(url)) {
      return res.status(400).json({ error: "That doesn't look like a Google Sheet link" })
    }
    await setSetting('sheets_url', url)
    if (!url) return res.json({ ok: true, synced: 0 })
    try {
      const count = await syncLeadsToSheet()
      res.json({ ok: true, synced: count })
    } catch (e) {
      res.status(502).json({ error: e.message })
    }
  }),
)

// Push leads into the linked sheet now.
adminRouter.post(
  '/sheets/sync',
  ah(async (_req, res) => {
    try {
      const count = await syncLeadsToSheet()
      res.json({ ok: true, synced: count })
    } catch (e) {
      res.status(502).json({ error: e.message })
    }
  }),
)
