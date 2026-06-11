import crypto from 'node:crypto'
import { config } from '../config.js'

const { mode, keyId, keySecret, pricePaise } = config.razorpay

// Create a ₹99 order. In mock mode we fabricate an order so the whole funnel
// is testable with no real keys. In live mode we call Razorpay's Orders API.
export async function createOrder(phone) {
  if (mode === 'mock' || !keyId || !keySecret) {
    return {
      mock: true,
      orderId: `mock_${Date.now()}_${phone}`,
      amount: pricePaise,
      currency: 'INR',
      keyId: 'rzp_mock',
    }
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: pricePaise,
      currency: 'INR',
      notes: { phone },
    }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.description || JSON.stringify(j)
    } catch {
      /* ignore */
    }
    throw new Error(`Razorpay order failed (${res.status}): ${detail}`)
  }
  const order = await res.json()
  return {
    mock: false,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId,
  }
}

// Server-side source of truth: ask Razorpay whether an order has a captured
// payment. Heals payments whose browser callback / webhook never arrived
// (e.g. UPI QR scanned on a phone while the page was closed).
export async function orderHasCapturedPayment(orderId) {
  if (isMock() || !orderId || String(orderId).startsWith('mock_')) return false
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!res.ok) return false
  const j = await res.json()
  const items = j.items || []
  if (items.some((p) => p.status === 'captured')) return true

  // Money taken but stuck at 'authorized' (payment capture set to manual in
  // the Razorpay dashboard) — capture it now, otherwise Razorpay auto-refunds
  // it after a few days and the customer's booking silently dies.
  const authorized = items.find((p) => p.status === 'authorized')
  if (authorized) {
    const cap = await fetch(`https://api.razorpay.com/v1/payments/${authorized.id}/capture`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: authorized.amount, currency: authorized.currency }),
    })
    if (cap.ok) return true
    // eslint-disable-next-line no-console
    console.error(`[payment] capture failed for ${authorized.id} (${cap.status})`)
  }
  return false
}

// For a static hosted payment link there's no order id to reconcile against,
// so ask Razorpay for a recently-captured payment whose payer contact matches
// this lead's phone. Looks back `windowMins` (default 2h). Live keys only.
export async function recentCapturedPaymentForPhone(phone, windowMins = 120) {
  if (isMock() || !keyId || !keySecret) return null
  const last10 = String(phone).replace(/\D/g, '').slice(-10)
  if (last10.length !== 10) return null
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const from = Math.floor(Date.now() / 1000) - windowMins * 60
  const res = await fetch(`https://api.razorpay.com/v1/payments?count=100&from=${from}`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!res.ok) return null
  const j = await res.json()
  const match = (j.items || []).find(
    (p) =>
      (p.status === 'captured' || p.status === 'authorized') &&
      String(p.contact || '').replace(/\D/g, '').slice(-10) === last10,
  )
  if (!match) return null
  // capture it if it's only authorized (manual-capture accounts)
  if (match.status === 'authorized') {
    await fetch(`https://api.razorpay.com/v1/payments/${match.id}/capture`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: match.amount, currency: match.currency }),
    }).catch(() => {})
  }
  return { paymentId: match.id, amount: match.amount, contact: match.contact || null }
}

// Contact the customer typed during payment — looked up by payment id.
// Used to backfill the admin "Pay phone" column for older payments.
export async function paymentContact(paymentId) {
  if (isMock() || !paymentId) return null
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!res.ok) return null
  const p = await res.json().catch(() => null)
  return p?.contact || null
}

// Same, but via the order (when we stored the order id but not the payment id).
export async function orderPaymentContact(orderId) {
  if (isMock() || !orderId || String(orderId).startsWith('mock_')) return null
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!res.ok) return null
  const j = await res.json().catch(() => ({}))
  const items = j.items || []
  const p = items.find((x) => x.status === 'captured') || items[0]
  return p?.contact || null
}

// Verify the payment signature from Razorpay checkout. Mock mode always passes.
export function verifyPayment({ orderId, paymentId, signature }) {
  if (mode === 'mock' || !keySecret) return true
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
  return expected === signature
}

export const isMock = () => mode === 'mock' || !keyId || !keySecret
