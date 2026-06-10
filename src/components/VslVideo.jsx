import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getLead, saveLead } from '../lib/session.js'

const ENV_SRC = import.meta.env.VITE_VSL_SRC || '' // optional fallback
const API_BASE = import.meta.env.VITE_API_URL || '' // prefix for /uploads in prod
const abs = (path) => (path ? `${API_BASE}${path}` : '')

function unlockBooking(ref) {
  if (ref.current) return
  ref.current = true
  window.dispatchEvent(new CustomEvent('booking-unlock'))
}

// ---- Form 1: Name + WhatsApp (shown after the play button is pressed) ----
function RegistrationGate({ onSubmit }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!name.trim() || phone.replace(/\D/g, '').length < 8) {
      setErr('Please enter your name and a valid WhatsApp number.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(name.trim(), phone)
    } catch (e2) {
      setErr(e2.message || 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <form className="reg-gate" onSubmit={submit}>
      <p className="reg-gate-title">Enter your details to start the video</p>
      <input className="reg-input" type="text" placeholder="Your name" value={name}
        onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
      <input className="reg-input" type="tel" inputMode="numeric" placeholder="WhatsApp number" value={phone}
        onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      {err && <p className="reg-error">{err}</p>}
      <button type="submit" className="cta reg-submit" disabled={busy}>
        {busy ? 'Please wait…' : 'Submit & watch'}
      </button>
    </form>
  )
}

// ---- Player + gate + watch-time tracking ----
export default function VslVideo() {
  const [registered, setRegistered] = useState(Boolean(getLead()?.phone))
  const [stage, setStage] = useState('play') // play | form
  const [cfg, setCfg] = useState(null)
  const videoRef = useRef(null)
  const fired = useRef({})
  const lastPercentSent = useRef(0)
  const unlocked = useRef(false)

  useEffect(() => {
    const onChange = () => setRegistered(Boolean(getLead()?.phone))
    window.addEventListener('lead-changed', onChange)
    api.config()
      .then((c) => {
        setCfg(c)
        if (!c.videoUrl && !ENV_SRC) unlockBooking(unlocked)
      })
      .catch(() => { if (!ENV_SRC) unlockBooking(unlocked) })
    return () => window.removeEventListener('lead-changed', onChange)
  }, [])

  function fire(checkpoint, percent) {
    const phone = getLead()?.phone
    if (!phone) return
    if (checkpoint && fired.current[checkpoint]) return
    if (checkpoint) fired.current[checkpoint] = true
    api.progress(phone, checkpoint, Math.round(percent)).catch(() => {})
  }

  const revealSeconds = cfg?.revealSeconds ?? 900
  const src = abs(cfg?.videoUrl) || ENV_SRC
  const poster = abs(cfg?.thumbUrl) || undefined

  function onTimeUpdate(e) {
    const v = e.currentTarget
    if (v.duration) {
      const pct = (v.currentTime / v.duration) * 100
      if (pct >= 25) fire('25', pct)
      if (v.currentTime >= 480) fire('8min', pct)
      if (v.currentTime >= 900) fire('15min', pct)
      if (pct - lastPercentSent.current >= 10) { lastPercentSent.current = pct; fire('', pct) }
    }
    if (v.currentTime >= revealSeconds) unlockBooking(unlocked)
  }

  // register, then start playing the video (the Submit click is the user gesture)
  async function handleSubmit(name, phone) {
    const { phone: saved } = await api.register(name, phone)
    saveLead({ name, phone: saved })
    setRegistered(true)
    requestAnimationFrame(() => videoRef.current?.play?.().catch(() => {}))
  }

  return (
    <div className="video-frame">
      {src ? (
        <video
          id="vsl-video"
          className="vsl-player"
          ref={videoRef}
          src={src}
          poster={poster}
          controls={registered}
          playsInline
          preload="metadata"
          onTimeUpdate={onTimeUpdate}
          onEnded={() => { fire('finished', 100); unlockBooking(unlocked) }}
        />
      ) : (
        <div
          className="placeholder"
          id="vsl-video"
          style={poster ? { backgroundImage: `url(${poster})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          {registered && (
            <>
              <span>[VSL video — upload it in the admin panel]</span>
              {import.meta.env.DEV && (
                <div className="vsl-sim">
                  <span className="vsl-sim-label">dev: simulate watch-time</span>
                  <div className="vsl-sim-btns">
                    <button type="button" onClick={() => fire('25', 25)}>25%</button>
                    <button type="button" onClick={() => fire('8min', 55)}>8 min</button>
                    <button type="button" onClick={() => { fire('15min', 80); unlockBooking(unlocked) }}>15 min</button>
                    <button type="button" onClick={() => { fire('finished', 100); unlockBooking(unlocked) }}>finish</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Gate overlay: centered play button → Name/WhatsApp form → play */}
      {!registered && (
        <div className={`gate-overlay ${stage === 'form' ? 'gate-overlay--form' : ''}`}>
          {stage === 'play' ? (
            <button className="gate-play" aria-label="Play video" onClick={() => setStage('form')}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          ) : (
            <RegistrationGate onSubmit={handleSubmit} />
          )}
        </div>
      )}
    </div>
  )
}
