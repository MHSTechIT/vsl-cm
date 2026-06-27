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
  const [details, setDetails] = useState(() => {
    const lead = getLead() || {}
    const params = new URLSearchParams(window.location.search)
    const phone = (params.get('phone') || lead.phone || '').replace(/\D/g, '')
    return { name: lead.name || '', email: '', mobile: phone, paymentId: '' }
  })
  const fired = useRef(false)

  useEffect(() => { document.title = 'Thank You — My Health School' }, [])

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
          setDetails((d) => ({
            name: r.name || d.name,
            email: r.email || d.email,
            mobile: r.mobile || d.mobile,
            paymentId: r.paymentId || d.paymentId,
          }))
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

  // Confirmed payment → full-page Thank You (matches the brand confirmation page).
  if (status === 'success') {
    return (
      <main className="ty-page">
        <div className="ty">
          <div className="ty-check" aria-hidden="true">✓</div>
          <h1 className="ty-title">Congratulations — your payment is confirmed!</h1>
          <p className="ty-sub">
            Thank you for booking your 1:1 Diabetes Recovery Assessment Call. Your payment
            receipt has been sent to your email and WhatsApp.
          </p>
          <div className="ty-next">
            <p className="ty-next-label">WHAT HAPPENS NEXT</p>
            <p className="ty-next-head">
              Our team will call you back shortly to schedule your one-to-one specialist
              consultation.
            </p>
            <p className="ty-next-body">
              Please keep your phone handy — most callbacks happen within the next few working
              hours. We’re looking forward to partnering with you on your journey to reverse
              diabetes and reclaim your health.
            </p>
          </div>

          <div className="ty-card">
            <p className="ty-card-label">YOUR DETAILS</p>
            <div className="ty-row"><span>Name</span><strong>{details.name || '—'}</strong></div>
            <div className="ty-row"><span>Mobile</span><strong>{details.mobile ? `+91${details.mobile}` : '—'}</strong></div>
          </div>

          <div className="ty-card ty-card--support">
            <p className="ty-card-label">OUR SUPPORT CONTACT</p>
            <p className="ty-support-intro">In case you want to reach out to us, here are our support details:</p>
            <div className="ty-row"><span>Email</span><strong>support@myhealthschool.in</strong></div>
            <div className="ty-row"><span>Mobile</span><strong>+91-9952711053</strong></div>
          </div>

          <a className="cta ty-home" href="/">Back to home</a>
        </div>
      </main>
    )
  }

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
