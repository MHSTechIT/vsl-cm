import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getLead, saveLead } from '../lib/session.js'
import { isFreeFunnel } from '../lib/funnel.js'
import { trackAppointmentBooked, trackPurchase } from '../lib/tracking.js'

const isFree = isFreeFunnel()

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ---- Monthly calendar: only dates with open seats are clickable; the rest
// look embedded (recessed) so visitors instantly read them as unavailable.
const BK_WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const pad2 = (n) => String(n).padStart(2, '0')

function SlotCalendar({ availableDates, selected, onPick }) {
  const avail = new Set(availableDates)
  const base = selected || availableDates[0]
  const d0 = base ? new Date(base + 'T00:00:00') : new Date()
  const [view, setView] = useState({ y: d0.getFullYear(), m: d0.getMonth() })

  const iso = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`
  const firstWd = (new Date(view.y, view.m, 1).getDay() + 6) % 7 // Monday-first
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const label = new Date(view.y, view.m, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
  const move = (delta) => {
    let m = view.m + delta, y = view.y
    if (m < 0) { m = 11; y -= 1 } else if (m > 11) { m = 0; y += 1 }
    setView({ y, m })
  }
  const cells = []
  for (let i = 0; i < firstWd; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)

  return (
    <div className="bk-cal">
      <div className="bk-cal-head">
        <button type="button" className="bk-cal-nav" onClick={() => move(-1)} aria-label="Previous month">‹</button>
        <span className="bk-cal-month">{label}</span>
        <button type="button" className="bk-cal-nav" onClick={() => move(1)} aria-label="Next month">›</button>
      </div>
      <div className="bk-cal-grid">
        {BK_WEEKDAYS.map((w) => <span key={w} className="bk-cal-wd">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} />
          const dISO = iso(view.y, view.m, d)
          const ok = avail.has(dISO)
          return (
            <button
              key={dISO}
              type="button"
              disabled={!ok}
              className={`bk-day ${ok ? 'is-avail' : ''} ${dISO === selected ? 'is-sel' : ''}`}
              onClick={() => onPick(dISO)}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}
function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

export default function BookingModal({ onClose }) {
  const lead = getLead()
  const [name, setName] = useState(lead?.name || '')
  const [phone, setPhone] = useState(lead?.phone || '')

  const [dates, setDates] = useState([])
  const [date, setDate] = useState('')
  const [times, setTimes] = useState([])
  const [time, setTime] = useState('')

  const [status, setStatus] = useState('form') // form | paying | done | failed
  const [err, setErr] = useState('')
  const [confirmed, setConfirmed] = useState(null) // {date,time}
  const [secsLeft, setSecsLeft] = useState(0)
  const [paymentLink, setPaymentLink] = useState(null) // hosted rzp.io page, if configured
  const holdTimer = useRef(null)
  const pollTimer = useRef(null)
  const rzpRef = useRef(null)
  const doneRef = useRef(false)
  const linkModeRef = useRef(false)
  const payingPhone = useRef('')
  const attemptSince = useRef(0) // epoch secs when this pay attempt began

  // load available dates + config (payment link) on open
  useEffect(() => {
    api.slotDates().then(setDates).catch(() => setErr('Could not load dates.'))
    api.config().then((c) => setPaymentLink(c?.paymentLink || null)).catch(() => {})
    return () => {
      clearInterval(holdTimer.current)
      clearInterval(pollTimer.current)
    }
  }, [])

  // Safety net for UPI QR payments: the Razorpay success callback doesn't
  // always fire (QR scanned on a phone, tab in background…), so poll the
  // backend — it checks with Razorpay directly and confirms the booking.
  function startPaymentPoll(phone, orderId) {
    clearInterval(pollTimer.current)
    let ticks = 0
    pollTimer.current = setInterval(async () => {
      if (++ticks > 180) {
        // ~15 min with no confirmed payment → treat as failed/timed-out
        clearInterval(pollTimer.current)
        if (linkModeRef.current) fail("We didn't receive your payment. Please try again.")
        return
      }
      try {
        const s = await api.paymentStatus(phone, orderId, attemptSince.current)
        if (s.paid) {
          finish({ date: s.date, time: s.time })
          try { rzpRef.current?.close?.() } catch { /* modal may already be gone */ }
        }
      } catch { /* transient network error — keep polling */ }
    }, 5000)
  }

  async function pickDate(d) {
    setDate(d)
    setTime('')
    setTimes([])
    try {
      setTimes(await api.slotsForDate(d))
    } catch {
      setErr('Could not load times.')
    }
  }

  function startHoldCountdown(expiresAtIso) {
    clearInterval(holdTimer.current)
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(expiresAtIso) - new Date()) / 1000))
      setSecsLeft(left)
      if (left <= 0) {
        clearInterval(holdTimer.current)
        // hosted-link payer ran out the hold window without a confirmed payment
        if (linkModeRef.current && !doneRef.current) {
          fail('Your slot hold expired before payment came through. Please book again.')
        }
      }
    }
    tick()
    holdTimer.current = setInterval(tick, 1000)
  }

  function fail(reason) {
    if (doneRef.current) return // a real confirmation already won
    clearInterval(holdTimer.current)
    clearInterval(pollTimer.current)
    setErr(reason || '')
    setStatus('failed')
  }

  // Reset back to the form so the payer can retry.
  function retry() {
    doneRef.current = false
    linkModeRef.current = false
    clearInterval(holdTimer.current)
    clearInterval(pollTimer.current)
    setErr('')
    setSecsLeft(0)
    setStatus('form')
  }

  async function confirmAndPay() {
    setErr('')
    if (!name.trim() || phone.replace(/\D/g, '').length < 8 || !date || !time) {
      setErr('Please enter your details and pick a date + time.')
      return
    }

    // Anchor this attempt in time: the backend only confirms payments made
    // at/after this instant, so a stale/earlier payment can't false-confirm.
    attemptSince.current = Math.floor(Date.now() / 1000)

    // Hosted-link mode: open a blank tab NOW (inside the click) so the browser
    // doesn't block it after our async calls; we point it at the link below.
    let payWin = null
    if (!isFree && paymentLink) payWin = window.open('', '_blank')

    setStatus('paying')
    try {
      // ensure the lead exists (Form 2 may be the first touch for warm traffic)
      const { phone: saved } = await api.register(name.trim(), phone)
      saveLead({ name: name.trim(), phone: saved })

      // claim one seat for this time (the backend returns the seat id)
      const hold = await api.holdSlot(saved, name.trim(), date, time)
      const slotId = hold.slotId
      startHoldCountdown(hold.holdExpiresAt)

      // ── FREE funnel ───────────────────────────────────────────────────────
      // No payment — confirm the held seat directly and show the success card.
      if (isFree) {
        const r = await api.freeConfirm(saved)
        finish(r)
        return
      }

      // ── Hosted Razorpay page ──────────────────────────────────────────────
      // Seat is held + lead saved. Send the payer to the hosted page; the
      // webhook matches the payment back by the phone they enter and confirms
      // the booking. We poll /status so THIS page flips to "confirmed" too.
      if (paymentLink) {
        linkModeRef.current = true
        payingPhone.current = saved
        startPaymentPoll(saved) // no order id — webhook sets `paid`, poll reads it
        if (payWin) payWin.location.href = paymentLink
        else window.open(paymentLink, '_blank')
        return
      }

      // create the ₹50 order (Checkout-popup path)
      const order = await api.createOrder(saved)

      if (order.mock) {
        // mock mode — verify immediately (no real Razorpay)
        const r = await api.verifyPayment({ phone: saved, slotId, orderId: order.orderId })
        finish(r)
        return
      }

      const ok = await loadRazorpay()
      if (!ok) throw new Error('Could not load payment. Please try again.')
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'My Health School',
        description: 'Health assessment — ₹50',
        prefill: { name: name.trim(), contact: saved },
        theme: { color: '#6d28d9' },
        handler: async (resp) => {
          try {
            const r = await api.verifyPayment({
              phone: saved,
              slotId,
              orderId: resp.razorpay_order_id,
              paymentId: resp.razorpay_payment_id,
              signature: resp.razorpay_signature,
            })
            finish(r)
          } catch (e) {
            setErr(e.message)
            setStatus('form')
          }
        },
        // keep polling after dismiss — a QR payment may still land
        modal: { ondismiss: () => { if (!doneRef.current) setStatus('form') } },
      })
      rzpRef.current = rzp
      rzp.open()
      startPaymentPoll(saved, order.orderId)
    } catch (e) {
      try { payWin?.close() } catch { /* ignore */ }
      setErr(e.message || 'Booking failed. Please try again.')
      setStatus('form')
    }
  }

  // Manual "I've paid" re-check for the hosted-link flow.
  async function recheckPayment() {
    setErr('')
    try {
      const s = await api.paymentStatus(payingPhone.current, undefined, attemptSince.current)
      if (s.paid) finish({ date: s.date, time: s.time })
      else setErr('Not confirmed yet — give it a few seconds after paying, then check again.')
    } catch {
      setErr('Could not check just now — try again in a moment.')
    }
  }

  function finish(r) {
    if (doneRef.current) return // handler + poll can both land — first one wins
    doneRef.current = true
    clearInterval(holdTimer.current)
    clearInterval(pollTimer.current)
    trackAppointmentBooked() // booking confirmed → success card appears
    if (!isFree) trackPurchase(50, 'INR') // free funnel has no purchase
    setConfirmed({ date: r.date, time: r.time })
    setStatus('done')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        {status === 'done' ? (
          <div className="booking-done">
            <div className="booking-tick" aria-hidden="true">✓</div>
            <h3>{isFree ? 'Slot confirmed' : 'Payment successful — slot confirmed'}</h3>
            <p>
              Your {isFree ? 'masterclass' : 'health assessment'} is booked for{' '}
              <strong>{fmtDate(confirmed.date)}</strong> at <strong>{confirmed.time}</strong>.
            </p>
            <p className="caption">Our team will call you. A confirmation has been sent on WhatsApp.</p>
            <button className="cta" onClick={onClose}>Done</button>
          </div>
        ) : status === 'failed' ? (
          <div className="booking-done booking-failed">
            <div className="booking-tick booking-cross" aria-hidden="true">✕</div>
            <h3>Payment not completed</h3>
            <p>{err || "We couldn't confirm your payment."}</p>
            <p className="caption">
              If money was deducted, it will auto-refund — or message us and we'll sort it out.
            </p>
            <div className="pay-wait-actions">
              <button className="cta" onClick={retry}>Try again</button>
              <button className="cta cta-ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <h3 className="modal-title">
              {isFree ? 'Book your free masterclass slot' : 'Book your ₹50 health assessment'}
            </h3>

            <input
              className="reg-input"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="reg-input"
              type="tel"
              inputMode="numeric"
              placeholder="Phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />

            <p className="modal-label">Select a date</p>
            {dates.length === 0 ? (
              <p className="caption">No dates open right now.</p>
            ) : (
              <SlotCalendar
                availableDates={dates.map((d) => d.date)}
                selected={date}
                onPick={pickDate}
              />
            )}

            {date && (
              <>
                <p className="modal-label">Select a time — {fmtDate(date)}</p>
                <div className="bk-slots">
                  {times.length === 0 && <span className="caption">Loading times…</span>}
                  {times.map((t) => {
                    const full = t.left <= 0
                    return (
                      <button
                        key={t.time}
                        type="button"
                        disabled={full}
                        className={`bk-slot ${full ? 'is-booked' : ''} ${time === t.time ? 'is-sel' : ''}`}
                        onClick={() => setTime(t.time)}
                      >
                        <span className="bk-slot-time">{t.time}</span>
                        <span className="bk-slot-sub">{full ? 'Booked' : 'Available'}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {secsLeft > 0 && status === 'paying' && (
              <p className="caption hold-note">
                Slot held — complete payment within {Math.floor(secsLeft / 60)}:
                {String(secsLeft % 60).padStart(2, '0')}
              </p>
            )}
            {err && <p className="reg-error">{err}</p>}

            {status === 'paying' && paymentLink ? (
              <div className="pay-wait">
                <p>
                  Complete the ₹50 payment in the Razorpay tab — <strong>use this same
                  phone number</strong>. This page confirms automatically once it's paid.
                </p>
                <div className="pay-wait-actions">
                  <a className="cta" href={paymentLink} target="_blank" rel="noopener noreferrer">
                    Open payment page
                  </a>
                  <button className="cta cta-ghost" type="button" onClick={recheckPayment}>
                    I've paid — check now
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="cta"
                onClick={confirmAndPay}
                disabled={!time || status === 'paying'}
              >
                {status === 'paying' ? 'Processing…' : isFree ? 'Book My Free Slot' : 'Book My Appointment'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
