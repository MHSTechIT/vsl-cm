import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getLead, saveLead } from '../lib/session.js'

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
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

  const [status, setStatus] = useState('form') // form | paying | done
  const [err, setErr] = useState('')
  const [confirmed, setConfirmed] = useState(null) // {date,time}
  const [secsLeft, setSecsLeft] = useState(0)
  const holdTimer = useRef(null)
  const pollTimer = useRef(null)
  const rzpRef = useRef(null)
  const doneRef = useRef(false)

  // load available dates on open
  useEffect(() => {
    api.slotDates().then(setDates).catch(() => setErr('Could not load dates.'))
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
      if (++ticks > 180) return clearInterval(pollTimer.current) // give up after ~15 min
      try {
        const s = await api.paymentStatus(phone, orderId)
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
      if (left <= 0) clearInterval(holdTimer.current)
    }
    tick()
    holdTimer.current = setInterval(tick, 1000)
  }

  async function confirmAndPay() {
    setErr('')
    if (!name.trim() || phone.replace(/\D/g, '').length < 8 || !date || !time) {
      setErr('Please enter your details and pick a date + time.')
      return
    }
    setStatus('paying')
    try {
      // ensure the lead exists (Form 2 may be the first touch for warm traffic)
      const { phone: saved } = await api.register(name.trim(), phone)
      saveLead({ name: name.trim(), phone: saved })

      // claim one seat for this time (the backend returns the seat id)
      const hold = await api.holdSlot(saved, name.trim(), date, time)
      const slotId = hold.slotId
      startHoldCountdown(hold.holdExpiresAt)

      // create the ₹99 order
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
        description: 'Health assessment — ₹99',
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
      setErr(e.message || 'Booking failed. Please try again.')
      setStatus('form')
    }
  }

  function finish(r) {
    if (doneRef.current) return // handler + poll can both land — first one wins
    doneRef.current = true
    clearInterval(holdTimer.current)
    clearInterval(pollTimer.current)
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
            <h3>Slot confirmed</h3>
            <p>
              Your health assessment is booked for <strong>{fmtDate(confirmed.date)}</strong> at{' '}
              <strong>{confirmed.time}</strong>.
            </p>
            <p className="caption">Our team will call you. A confirmation has been sent on WhatsApp.</p>
            <button className="cta" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <h3 className="modal-title">Book your ₹99 health assessment</h3>

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
            <div className="chip-row">
              {dates.length === 0 && <span className="caption">No dates open right now.</span>}
              {dates.map((d) => (
                <button
                  key={d.date}
                  className={`chip ${date === d.date ? 'chip-active' : ''}`}
                  onClick={() => pickDate(d.date)}
                >
                  {fmtDate(d.date)}
                </button>
              ))}
            </div>

            {date && (
              <>
                <p className="modal-label">Select a time</p>
                <div className="chip-row">
                  {times.length === 0 && <span className="caption">No times for this date.</span>}
                  {times.map((t) => (
                    <button
                      key={t.time}
                      className={`chip ${time === t.time ? 'chip-active' : ''}`}
                      onClick={() => setTime(t.time)}
                      disabled={t.left <= 0}
                    >
                      {t.time}
                      {t.left <= 0 && <span className="chip-full"> · full</span>}
                    </button>
                  ))}
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

            <button
              className="cta"
              onClick={confirmAndPay}
              disabled={!time || status === 'paying'}
            >
              {status === 'paying' ? 'Processing…' : 'Confirm my slot — pay ₹99'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
