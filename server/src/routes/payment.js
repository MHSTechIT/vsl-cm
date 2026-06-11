import crypto from 'node:crypto'
import { Router } from 'express'
import { query } from '../db.js'
import { config } from '../config.js'
import { createOrder, verifyPayment, isMock, orderHasCapturedPayment } from '../lib/razorpay.js'
import { sendWhatsApp, confirmationMessage } from '../lib/whapi.js'
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
async function confirmPaidLead(phone, slotId = null) {
  const { rows: leadRows } = await query(
    `SELECT paid, slot_date, slot_time FROM leads WHERE phone = $1`,
    [phone],
  )
  if (!leadRows.length) return null
  const lead = leadRows[0]

  // Falling back to an 'available' seat is only safe for a first payment —
  // for an already-paid lead a webhook retry would silently eat extra seats.
  const seat = await claimSeat(phone, slotId, !lead.paid)
  if (!seat) {
    if (lead.paid) {
      return { date: lead.slot_date ? isoDate(lead.slot_date) : null, time: lead.slot_time }
    }
    return null
  }

  const date = isoDate(seat.slot_date)
  await query(
    `UPDATE leads SET paid = true, paid_at = now(), slot_status = 'confirmed', updated_at = now() WHERE phone = $1`,
    [phone],
  )
  sendWhatsApp(phone, confirmationMessage(date, seat.slot_time), 'confirmation').catch(() => {})
  return { date, time: seat.slot_time }
}

// Razorpay webhook — server-to-server confirmation (works even if the visitor
// closes the page before /verify runs). Registered with a RAW body parser in
// index.js so the signature can be verified.
export async function razorpayWebhook(req, res) {
  try {
    const secret = config.razorpay.webhookSecret
    const raw = req.body // Buffer (express.raw)
    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
      if (expected !== req.headers['x-razorpay-signature']) {
        return res.status(400).json({ error: 'invalid signature' })
      }
    }
    const event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw))
    const notes =
      event?.payload?.payment?.entity?.notes || event?.payload?.order?.entity?.notes || {}
    const phone = String(notes.phone || '').replace(/\D/g, '')
    if (['payment.captured', 'order.paid'].includes(event.event) && phone) {
      await confirmPaidLead(phone)
    }
    res.json({ ok: true })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[webhook] error:', e.message)
    res.status(400).json({ error: 'bad webhook' })
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
    const slotId = Number(req.body?.slotId)
    const { orderId, paymentId, signature } = req.body || {}
    if (!phone || !slotId) return res.status(400).json({ error: 'phone and slotId required' })

    const valid = isMock() ? true : verifyPayment({ orderId, paymentId, signature })
    if (!valid) return res.status(400).json({ error: 'payment verification failed' })

    const r = await confirmPaidLead(phone, slotId)
    if (!r) return res.status(409).json({ error: 'hold expired — please pick a slot again' })
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
    if (!phone) return res.json({ paid: false })

    const { rows } = await query(
      `SELECT paid, slot_date, slot_time, slot_status, rzp_order_id FROM leads WHERE phone = $1`,
      [phone],
    )
    if (!rows.length) return res.json({ paid: false })
    const lead = rows[0]

    // Paid + nothing newer pending = settled. (With an order id supplied we
    // also require it to be the order we know about, so a NEW attempt by a
    // previously-paid lead isn't reported done before its money arrives.)
    const settled =
      lead.paid &&
      lead.slot_status === 'confirmed' &&
      (!orderId || orderId === lead.rzp_order_id)
    if (settled) {
      return res.json({
        paid: true,
        date: lead.slot_date ? isoDate(lead.slot_date) : null,
        time: lead.slot_time,
      })
    }

    if (await orderHasCapturedPayment(orderId || lead.rzp_order_id)) {
      const r = await confirmPaidLead(phone)
      if (r) return res.json({ paid: true, date: r.date, time: r.time })
      // captured but no slot on record — still surface the payment
      await query(`UPDATE leads SET paid = true, paid_at = now(), updated_at = now() WHERE phone = $1`, [phone])
      return res.json({ paid: true, date: null, time: null })
    }
    res.json({ paid: false })
  }),
)
