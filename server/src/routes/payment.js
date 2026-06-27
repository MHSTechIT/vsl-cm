import crypto from 'node:crypto'
import { Router } from 'express'
import { query } from '../db.js'
import { config } from '../config.js'
import {
  createOrder,
  verifyPayment,
  isMock,
  orderHasCapturedPayment,
  recentCapturedPaymentForPhone,
  capturePayment,
} from '../lib/razorpay.js'
import { applySlotDrip } from '../lib/drip.js'
import { syncLeadsToSheetSafe } from '../lib/google-sheets.js'
import { sendWhatsApp, confirmationMessage } from '../lib/whapi.js'
import { watiConfigured, watiPaymentSuccess } from '../lib/wati.js'
import { isoDate } from './slots.js'
import { ah } from '../lib/ah.js'

export const paymentRouter = Router()

// Claim a seat for a paying lead. Tries, in order: the exact seat they held,
// any seat still held by them, then — only when takeAvailableIfReleased —
// any free seat for the date/time they chose (hold expired mid-payment; money
// has been captured, so the booking must be honored).
async function claimSeat(phone, slotId, takeAvailableIfReleased) {
  if (slotId) {
    const r = await query(
      `UPDATE slots SET status = 'confirmed', lead_phone = $2, hold_expires_at = NULL
        WHERE id = $1 AND held_by_phone = $2 AND status = 'pending'
        RETURNING slot_date, slot_time`,
      [slotId, phone],
    )
    if (r.rows.length) return r.rows[0]
  }
  const held = await query(
    `UPDATE slots SET status = 'confirmed', lead_phone = $1, hold_expires_at = NULL
      WHERE id = (SELECT id FROM slots WHERE held_by_phone = $1 AND status = 'pending' ORDER BY id LIMIT 1)
      RETURNING slot_date, slot_time`,
    [phone],
  )
  if (held.rows.length) return held.rows[0]
  if (!takeAvailableIfReleased) return null

  // Hold was released before payment landed — re-take a seat for their choice.
  const lead = await query(`SELECT slot_date, slot_time FROM leads WHERE phone = $1`, [phone])
  if (!lead.rows.length || !lead.rows[0].slot_date) return null
  const { slot_date, slot_time } = lead.rows[0]
  const free = await query(
    `UPDATE slots SET status = 'confirmed', lead_phone = $1, held_by_phone = NULL, hold_expires_at = NULL
      WHERE id = (SELECT id FROM slots WHERE slot_date = $2 AND slot_time = $3 AND status = 'available' ORDER BY id LIMIT 1)
      RETURNING slot_date, slot_time`,
    [phone, slot_date, slot_time],
  )
  if (free.rows.length) return free.rows[0]
  // eslint-disable-next-line no-console
  console.warn(`[payment] ${phone} paid but no free seat left for ${isoDate(slot_date)} ${slot_time} — confirming anyway, follow up manually`)
  return { slot_date, slot_time }
}

// Confirm a lead once payment is in (used by /verify, webhook and /status
// reconciliation). Safe to call repeatedly (webhook retries): a seat is only
// claimed while one is pending-held. A lead who already paid before can book
// again with the same phone — their newly held seat still gets confirmed.
async function confirmPaidLead(phone, slotId = null, paymentId = null, paymentPhone = null, amountPaise = null, email = null, orderId = null) {
  const { rows: leadRows } = await query(
    `SELECT paid, name, slot_date, slot_time FROM leads WHERE phone = $1`,
    [phone],
  )
  if (!leadRows.length) return null
  const lead = leadRows[0]
  const payPhone = paymentPhone ? String(paymentPhone).replace(/\D/g, '') : null
  const amountRupees = (Number(amountPaise) || config.razorpay.pricePaise) / 100

  // Log every distinct transaction. Deduped by payment_id (ON CONFLICT), so a
  // single payment's many webhook events / confirm paths record it ONCE.
  // RETURNING tells us whether THIS call is the first to see this payment — we
  // use that to send exactly ONE WhatsApp per payment, so repeat payments from
  // the same number EACH get their own confirmation message.
  let newPayment = false
  if (paymentId) {
    const ins = await query(
      `INSERT INTO payments (payment_id, phone, name, amount, currency)
       VALUES ($1, $2, $3, $4, 'INR')
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING payment_id`,
      [paymentId, phone, lead.name, amountRupees],
    ).catch(() => null)
    newPayment = Boolean(ins && ins.rowCount > 0)
  }
  // Mark THIS checkout's booking submission paid (matched by its order id), so
  // the Bookings list flips that one row from Unpaid → Paid.
  if (orderId) {
    await query(
      `UPDATE submissions
          SET paid = true, paid_at = COALESCE(paid_at, now()),
              rzp_payment_id = COALESCE(rzp_payment_id, $2),
              amount = COALESCE(amount, $3), email = COALESCE(email, $4)
        WHERE rzp_order_id = $1`,
      [orderId, paymentId, amountRupees, email ? String(email) : null],
    ).catch(() => {})
  }
  // Capture the email the payer entered in Razorpay (we don't collect it on the
  // form) — keep the first one seen. Shown on the Thank You page.
  if (email) {
    await query(`UPDATE leads SET email = COALESCE(NULLIF(email, ''), $2) WHERE phone = $1`, [phone, String(email)]).catch(() => {})
  }

  // Falling back to an 'available' seat is only safe for a first payment —
  // for an already-paid lead a webhook retry would silently eat extra seats.
  const seat = await claimSeat(phone, slotId, !lead.paid)
  if (!seat) {
    // No seat to claim — either a retry, or a slotless booking (customer pays
    // first, the team schedules later). Record the payment; fire the welcome-
    // video WhatsApp once per NEW payment (so each repeat payment from the same
    // number gets its own message; retries of the same payment do not).
    await query(
      `UPDATE leads
          SET paid = true, paid_at = COALESCE(paid_at, now()),
              rzp_payment_id = COALESCE($2, rzp_payment_id),
              payment_phone = COALESCE($3, payment_phone),
              payment_status = 'success', wa_payment = 'success', updated_at = now()
        WHERE phone = $1`,
      [phone, paymentId, payPhone],
    )
    if (newPayment) {
      if (watiConfigured()) {
        watiPaymentSuccess(phone, { name: lead.name }).catch((e) =>
          // eslint-disable-next-line no-console
          console.error('[wati] welcome video (payment success) failed:', e.message),
        )
      }
      syncLeadsToSheetSafe()
    }
    return { date: lead.slot_date ? isoDate(lead.slot_date) : null, time: lead.slot_time || null }
  }

  const date = isoDate(seat.slot_date)
  await query(
    `UPDATE leads
        SET paid = true, paid_at = now(), slot_status = 'confirmed',
            rzp_payment_id = COALESCE($2, rzp_payment_id),
            payment_phone = COALESCE($3, payment_phone),
            payment_status = 'success', wa_payment = 'success', updated_at = now()
      WHERE phone = $1`,
    [phone, paymentId, payPhone],
  )
  // payment confirmation WhatsApp — once per NEW payment (welcome-video template,
  // else Whapi text). Repeat payments from the same number each get a message.
  if (newPayment) {
    if (watiConfigured()) {
      watiPaymentSuccess(phone, { name: lead.name }).catch((e) =>
        // eslint-disable-next-line no-console
        console.error('[wati] welcome video (payment success) failed:', e.message),
      )
    } else {
      sendWhatsApp(phone, confirmationMessage(date, seat.slot_time), 'confirmation').catch(() => {})
    }
  }
  // each paid booking may unlock fake-booked seats (scarcity drip)
  applySlotDrip(date).catch(() => {})
  syncLeadsToSheetSafe() // reflect the paid status in the linked Google Sheet
  return { date, time: seat.slot_time }
}

// Resolve which lead a captured payment belongs to, in order of specificity:
//  1. notes.phone — we stamp this on every order we create (always a clean match)
//  2. payment.contact — last-10-digits fallback for payments not made via /order
// Returns the lead's phone (our PK) or null.
async function resolveLeadPhone(payment, order) {
  const notePhone = String(
    payment?.notes?.phone || order?.notes?.phone || '',
  ).replace(/\D/g, '')
  if (notePhone) {
    const r = await query('SELECT phone FROM leads WHERE phone = $1', [notePhone])
    if (r.rows.length) return { phone: r.rows[0].phone, matchedBy: 'notes.phone' }
  }
  const contact = String(payment?.contact || '').replace(/\D/g, '')
  const last10 = contact.slice(-10)
  if (last10.length === 10) {
    const r = await query(
      `SELECT phone FROM leads
        WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
        ORDER BY registered_at DESC LIMIT 1`,
      [last10],
    )
    if (r.rows.length) return { phone: r.rows[0].phone, matchedBy: 'contact' }
  }
  return { phone: null, matchedBy: null }
}

// A captured payment we can't tie to a lead is logged here (never dropped).
async function logUnmatchedPayment(payment, event) {
  await query(
    `INSERT INTO unmatched_payments
       (payment_id, order_id, amount, currency, payer_email, payer_phone, notes, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (payment_id) DO NOTHING`,
    [
      payment?.id || `unknown_${Date.now()}`,
      payment?.order_id || null,
      payment?.amount != null ? payment.amount / 100 : 0,
      payment?.currency || 'INR',
      payment?.email || null,
      payment?.contact || null,
      JSON.stringify(payment?.notes || {}),
      JSON.stringify(event || payment || {}),
    ],
  )
  // eslint-disable-next-line no-console
  console.error(
    `[webhook] UNMATCHED payment ${payment?.id} (${payment?.email || payment?.contact || 'no contact'}) — logged to unmatched_payments`,
  )
}

async function handlePaymentCaptured(payment, event) {
  const order = event?.payload?.order?.entity || null
  const { phone, matchedBy } = await resolveLeadPhone(payment, order)
  if (!phone) {
    await logUnmatchedPayment(payment, event)
    return
  }
  const r = await confirmPaidLead(phone, null, payment?.id || null, payment?.contact || null, payment?.amount || null, payment?.email || null, payment?.order_id || order?.id || null)
  // eslint-disable-next-line no-console
  console.log(`[webhook] captured ${payment?.id} → ${phone} (${matchedBy})${r ? '' : ' [no seat to claim]'}`)
}

// The account is on MANUAL capture, so Razorpay sends payment.authorized
// (money held, not charged) and never payment.captured. Capture it ourselves,
// then confirm the booking. (Idempotent: the later payment.captured event —
// same payment id — is deduped by webhook_events.)
async function handlePaymentAuthorized(payment, event) {
  if (!payment?.id) return
  const ok = await capturePayment(payment.id, payment.amount, payment.currency || 'INR')
  // eslint-disable-next-line no-console
  console.log(`[webhook] authorized ${payment.id} → capture ${ok ? 'ok' : 'FAILED'}`)
  if (ok) await handlePaymentCaptured({ ...payment, status: 'captured' }, event)
}

async function handlePaymentFailed(payment) {
  const notePhone = String(payment?.notes?.phone || '').replace(/\D/g, '')
  const contact10 = String(payment?.contact || '').replace(/\D/g, '').slice(-10)
  const phone = notePhone || contact10
  if (phone) {
    // record the failed attempt on the lead so the registry shows it.
    // No WhatsApp is sent on failure (only payment_success is messaged).
    await query(
      `UPDATE leads
          SET payment_status = 'failed',
              payment_phone = COALESCE($2, payment_phone), updated_at = now()
        WHERE phone = $1 AND paid = false`,
      [phone, payment?.contact ? contact10 : null],
    )
  }
  // eslint-disable-next-line no-console
  console.log(`[webhook] payment.failed ${payment?.id} phone=${phone || '?'} ${payment?.error_description || ''}`)
}

async function handleRefund(refund) {
  if (!refund?.payment_id) return
  const r = await query('SELECT phone FROM leads WHERE rzp_payment_id = $1', [refund.payment_id])
  if (!r.rows.length) {
    // eslint-disable-next-line no-console
    console.warn(`[webhook] refund ${refund.id} for unknown payment ${refund.payment_id}`)
    return
  }
  const phone = r.rows[0].phone
  const full = (refund.amount || 0) >= config.razorpay.pricePaise
  await query(`UPDATE leads SET refunded_at = now(), updated_at = now() WHERE phone = $1`, [phone])
  if (full) {
    // full refund — release the seat back to the pool and un-mark paid
    await query(
      `UPDATE slots SET status = 'available', lead_phone = NULL, held_by_phone = NULL, hold_expires_at = NULL
        WHERE lead_phone = $1 AND status = 'confirmed'`,
      [phone],
    )
    await query(
      `UPDATE leads SET paid = false, slot_status = NULL, updated_at = now() WHERE phone = $1`,
      [phone],
    )
  }
  // eslint-disable-next-line no-console
  console.log(`[webhook] refund ${refund.id} for ${refund.payment_id} — ${full ? 'full, seat released' : 'partial'}`)
}

// Razorpay webhook — server-to-server confirmation (works even if the visitor
// closes the page before /verify runs). Registered with a RAW body parser in
// index.js so the HMAC signature can be verified against the exact bytes.
export async function razorpayWebhook(req, res) {
  const secret = config.razorpay.webhookSecret
  const raw = req.body // Buffer (express.raw)

  // 1. Verify signature (timing-safe). Skipped only when no secret is set (dev).
  if (secret) {
    const sig = String(req.headers['x-razorpay-signature'] || '')
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
    const eb = Buffer.from(expected)
    const sb = Buffer.from(sig)
    if (eb.length !== sb.length || !crypto.timingSafeEqual(eb, sb)) {
      return res.status(400).json({ error: 'invalid signature' })
    }
  }

  let event
  try {
    event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw))
  } catch {
    return res.status(400).json({ error: 'bad json' })
  }

  const type = event?.event || 'unknown'
  const payment = event?.payload?.payment?.entity || null
  const refund = event?.payload?.refund?.entity || null
  const eventId = payment?.id || refund?.id || `evt_${type}`

  // 2. Idempotency gate — Razorpay retries; the same event_id is acked, not redone.
  try {
    await query(
      `INSERT INTO webhook_events (source, event_id, event_type) VALUES ('razorpay', $1, $2)`,
      [eventId, type],
    )
  } catch (e) {
    if (e.code === '23505') return res.sendStatus(200) // already processed
    // a logging hiccup shouldn't block a real payment — fall through and process
    // eslint-disable-next-line no-console
    console.error('[webhook] event-log insert failed:', e.message)
  }

  // 3. Dispatch (handler effects are idempotent via the atomic seat-claim too).
  try {
    if (type === 'payment.captured' || type === 'order.paid') {
      await handlePaymentCaptured(payment, event)
    } else if (type === 'payment.authorized') {
      await handlePaymentAuthorized(payment, event)
    } else if (type === 'payment.failed') {
      await handlePaymentFailed(payment)
    } else if (type === 'refund.processed' || type === 'refund.created') {
      await handleRefund(refund)
    } else {
      // eslint-disable-next-line no-console
      console.log(`[webhook] ignored event: ${type}`)
    }
    return res.json({ ok: true })
  } catch (e) {
    // Free the dedup row so Razorpay's retry can reprocess this event.
    await query(`DELETE FROM webhook_events WHERE source = 'razorpay' AND event_id = $1`, [eventId]).catch(() => {})
    // eslint-disable-next-line no-console
    console.error('[webhook] processing error:', e.message)
    return res.status(500).json({ error: 'processing failed' })
  }
}

// Create the ₹99 order (mock or live).
paymentRouter.post(
  '/order',
  ah(async (req, res) => {
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    if (!phone) return res.status(400).json({ error: 'phone required' })
    try {
      const order = await createOrder(phone)
      // remember the order so /status can reconcile with Razorpay later
      await query(`UPDATE leads SET rzp_order_id = $2, updated_at = now() WHERE phone = $1`, [
        phone,
        order.orderId,
      ])
      // Log this checkout as a NEW booking submission (one row per attempt, even
      // for the same number). Starts unpaid; marked paid only if payment lands.
      // So "reached Razorpay and went back" stays here as an unpaid booking.
      const { rows: lr } = await query(`SELECT name FROM leads WHERE phone = $1`, [phone])
      await query(
        `INSERT INTO submissions (phone, name, rzp_order_id) VALUES ($1, $2, $3)`,
        [phone, lr[0]?.name || null, order.orderId],
      ).catch(() => {})
      res.json(order)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[payment] order error:', e.message)
      res.status(502).json({ error: e.message })
    }
  }),
)

// Verify payment, confirm the slot, mark paid, fire confirmation WhatsApp.
paymentRouter.post(
  '/verify',
  ah(async (req, res) => {
    const phone = String(req.body?.phone || '').replace(/\D/g, '')
    const slotId = req.body?.slotId ? Number(req.body.slotId) : null
    const { orderId, paymentId, signature } = req.body || {}
    if (!phone) return res.status(400).json({ error: 'phone required' })

    const valid = isMock() ? true : verifyPayment({ orderId, paymentId, signature })
    if (!valid) return res.status(400).json({ error: 'payment verification failed' })

    // popup path: the payer's contact is the number they registered with
    const r = await confirmPaidLead(phone, slotId, paymentId || null, phone, null, null, orderId || null)
    if (!r) return res.status(409).json({ error: 'could not confirm payment — please try again' })
    res.json({ ok: true, date: r.date, time: r.time })
  }),
)

// Payment status — polled by the booking page while checkout is open, so QR
// payments confirm even when the browser callback never fires. If the lead
// isn't marked paid yet, asks Razorpay directly and self-heals. Pass
// ?order=<rzp order id> to scope the answer to the CURRENT attempt — without
// it, a lead who paid in the past would read as paid before paying again.
paymentRouter.get(
  '/status/:phone',
  ah(async (req, res) => {
    const phone = String(req.params.phone || '').replace(/\D/g, '')
    const orderId = String(req.query.order || '')
    // `since` (epoch seconds) = when the payer started THIS attempt, so a
    // payment from an earlier session can't falsely confirm this booking.
    const since = Number(req.query.since) || null
    if (!phone) return res.json({ paid: false })

    const { rows } = await query(
      `SELECT paid, paid_at, slot_date, slot_time, slot_status, rzp_order_id,
              name, email, rzp_payment_id FROM leads WHERE phone = $1`,
      [phone],
    )
    if (!rows.length) return res.json({ paid: false })
    const lead = rows[0]

    // Fast-path "settled" must NEVER fire just because this lead paid BEFORE.
    // The order row is created before payment, so an order-id match proves
    // nothing — when an order id is given we always verify the real payment via
    // Razorpay below (so the same number must actually pay again each time).
    // Only confirm on the flag when there's no order to check AND, if a `since`
    // anchor is present, the payment is at/after this attempt.
    const paidAtEpoch = lead.paid_at ? Math.floor(new Date(lead.paid_at).getTime() / 1000) : 0
    const settled =
      lead.paid && !orderId &&
      (since ? paidAtEpoch >= since : true)
    if (settled) {
      return res.json({
        paid: true,
        date: lead.slot_date ? isoDate(lead.slot_date) : null,
        time: lead.slot_time,
        name: lead.name, email: lead.email || null, mobile: phone, paymentId: lead.rzp_payment_id || null,
      })
    }

    // Reconcile with Razorpay directly: by order id (Checkout popup), or — for
    // a static hosted link with no order — by a recent captured payment whose
    // contact matches this phone. Either path removes the webhook dependency.
    let captured = await orderHasCapturedPayment(orderId || lead.rzp_order_id)
    let payId = null
    let payContact = null
    if (!captured) {
      // Hosted-link reconcile ONLY (no order id anywhere to verify against):
      // match a recent captured payment for this attempt. When we DO have an
      // order (the in-page popup always does), we rely solely on that order
      // above — so a recent prior payment from the same number can't confirm a
      // new, unpaid attempt.
      if (since && !orderId && !lead.rzp_order_id) {
        const recent = await recentCapturedPaymentForPhone(phone, {
          sinceEpoch: since,
          minAmountPaise: config.razorpay.pricePaise,
        })
        if (recent) { captured = true; payId = recent.paymentId; payContact = recent.contact }
      }
    }
    if (captured) {
      const r = await confirmPaidLead(phone, null, payId, payContact, null, null, orderId || lead.rzp_order_id || null)
      if (r) {
        const { rows: fr } = await query(
          `SELECT name, email, rzp_payment_id FROM leads WHERE phone = $1`, [phone],
        )
        const f = fr[0] || {}
        return res.json({
          paid: true, date: r.date, time: r.time,
          name: f.name, email: f.email || null, mobile: phone, paymentId: f.rzp_payment_id || null,
        })
      }
      // captured but no slot on record — still surface the payment
      await query(
        `UPDATE leads SET paid = true, paid_at = now(),
            rzp_payment_id = COALESCE($2, rzp_payment_id), updated_at = now()
          WHERE phone = $1`,
        [phone, payId],
      )
      return res.json({ paid: true, date: null, time: null })
    }
    res.json({ paid: false })
  }),
)
