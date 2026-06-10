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
  if (!res.ok) throw new Error(`razorpay order failed: ${res.status}`)
  const order = await res.json()
  return {
    mock: false,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId,
  }
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
