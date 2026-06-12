import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getLead } from '../lib/session.js'
import { trackAppointmentBooked, trackPurchase } from '../lib/tracking.js'

// Razorpay redirect landing. The webhook is the source of truth — this page
// only ASKS the server (the existing /payment/status endpoint, which self-heals
// against Razorpay) whether the payment confirmed, then shows the success card.
// A fresh full-page load after the redirect, so we re-establish the phone from
// the URL or localStorage and poll until the booking settles.

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

const POLL_MS = 2000
const MAX_TRIES = 15 // ~30s before we fall back to the "confirming" message

export default function PaymentSuccess() {
  const [status, setStatus] = useState('checking') // checking | success | pending | error
  const [info, setInfo] = useState({ date: null, time: null })
  const fired = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const phone = (params.get('phone') || getLead()?.phone || '').replace(/\D/g, '')
    // scope to THIS attempt when Razorpay hands back an order id
    const order = params.get('order') || params.get('razorpay_order_id') || ''
    if (!phone) { setStatus('error'); return }

    let tries = 0
    let timer = null
    let alive = true

    const tick = async () => {
      if (!alive) return
      tries++
      try {
        const r = await api.paymentStatus(phone, order || undefined)
        if (!alive) return
        if (r?.paid) {
          setInfo({ date: r.date, time: r.time })
          setStatus('success')
          if (!fired.current) {
            fired.current = true
            trackAppointmentBooked()
            trackPurchase(50, 'INR')
          }
          return // settled — stop polling
        }
      } catch { /* transient — keep polling */ }
      if (tries >= MAX_TRIES) { setStatus('pending'); return }
      timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  return (
    <main className="pay-success-page">
      <div className="pay-success-card">
        {status === 'checking' && (
          <>
            <div className="pay-spinner" aria-hidden="true" />
            <h3>Confirming your payment…</h3>
            <p className="caption">This takes a few seconds — please don’t close this page.</p>
          </>
        )}

        {status === 'success' && (
          <div className="booking-done">
            <div className="booking-tick" aria-hidden="true">✓</div>
            <h3>Payment successful — slot confirmed</h3>
            {info.date ? (
              <p>
                Your health assessment is booked for <strong>{fmtDate(info.date)}</strong> at{' '}
                <strong>{info.time}</strong>.
              </p>
            ) : (
              <p>Your payment is confirmed.</p>
            )}
            <p className="caption">Our team will call you. A confirmation has been sent on WhatsApp.</p>
            <a className="cta" href="/">Done</a>
          </div>
        )}

        {status === 'pending' && (
          <>
            <div className="booking-tick pay-clock" aria-hidden="true">⏳</div>
            <h3>We’re confirming your payment</h3>
            <p className="caption">
              If money was deducted, your booking is safe — you’ll get a WhatsApp confirmation shortly.
            </p>
            <a className="cta" href="/">Back to home</a>
          </>
        )}

        {status === 'error' && (
          <>
            <h3>Couldn’t find your booking</h3>
            <p className="caption">Please return to the page and try again.</p>
            <a className="cta" href="/">Back to home</a>
          </>
        )}
      </div>
    </main>
  )
}
