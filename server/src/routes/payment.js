import crypto from 'node:crypto'
import { Router } from 'express'
import { query } from '../db.js'
import { config } from '../config.js'
import { createOrder, verifyPayment, isMock } from '../lib/razorpay.js'
import { sendWhatsApp, confirmationMessage } from '../lib/whapi.js'
import { isoDate } from './slots.js'
import { ah } from '../lib/ah.js'

export const paymentRouter = Router()

// Confirm a lead's pending slot once payment is in (used by /verify and webhook).
// Idempotent — does nothing if the lead is already paid.
async function confirmByPhone(phone) {
  const { rows: lead } = await query(`SELECT paid FROM leads WHERE phone = $1`, [phone])
  if (!lead.length || lead[0].paid) return null
  const { rows } = await query(
    `UPDATE slots SET status = 'confirmed', lead_phone = $1, hold_expires_at = NULL
      WHERE id = (SELECT id FROM slots WHERE held_by_phone = $1 AND status = 'pending' ORDER BY id LIMIT 1)
      RETURNING slot_date, slot_time`,
    [phone],
  )
  if (!rows.length) return null
  const date = isoDate(rows[0].slot_date)
  await query(
    `UPDATE leads SET paid = true, paid_at = now(), slot_status = 'confirmed', updated_at = now() WHERE phone = $1`,
    [phone],
  )
  sendWhatsApp(phone, confirmationMessage(date, rows[0].slot_time), 'confirmation').catch(() => {})
  return { date, time: rows[0].slot_time }
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
      await confirmByPhone(phone)
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
    const order = await createOrder(phone)
    res.json(order)
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

    const { rows } = await query(
      `UPDATE slots
          SET status = 'confirmed', lead_phone = $2, hold_expires_at = NULL
        WHERE id = $1 AND held_by_phone = $2 AND status = 'pending'
        RETURNING slot_date, slot_time`,
      [slotId, phone],
    )
    if (!rows.length) {
      return res.status(409).json({ error: 'hold expired — please pick a slot again' })
    }
    const slot = rows[0]
    const date = isoDate(slot.slot_date)

    await query(
      `UPDATE leads
          SET paid = true, paid_at = now(), slot_status = 'confirmed', updated_at = now()
        WHERE phone = $1`,
      [phone],
    )

    sendWhatsApp(phone, confirmationMessage(date, slot.slot_time), 'confirmation').catch(() => {})
    res.json({ ok: true, date, time: slot.slot_time })
  }),
)
