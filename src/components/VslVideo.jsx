import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getLead, saveLead } from '../lib/session.js'
import { openBooking } from '../lib/booking.js'

const ENV_SRC = import.meta.env.VITE_VSL_SRC || '' // optional fallback
const API_BASE = import.meta.env.VITE_API_URL || '' // prefix for /uploads in prod
const abs = (path) => (path ? `${API_BASE}${path}` : '')

// Permanent VSL video (hosted on Vimeo). Always used unless an admin Vimeo
// link explicitly overrides it — so the page never streams video from the DB.
const DEFAULT_VIMEO_ID = '1200407732'

function unlockBooking(ref) {
  if (ref.current) return
  ref.current = true
  window.dispatchEvent(new CustomEvent('booking-unlock'))
}

// Load the Vimeo Player SDK once (from Vimeo's CDN — no build dependency).
function loadVimeo() {
  return new Promise((resolve) => {
    if (window.Vimeo) return resolve(window.Vimeo)
    const s = document.createElement('script')
    s.src = 'https://player.vimeo.com/api/player.js'
    s.onload = () => resolve(window.Vimeo)
    s.onerror = () => resolve(null)
    document.body.appendChild(s)
  })
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

// True watch percent: sum of the ranges the viewer actually played, relative
// to the video's real duration — works the same for a 2-min or 15-min video
// and isn't inflated by dragging the scrubber forward.
function playedPercent(v) {
  if (!v.duration) return 0
  let secs = 0
  for (let i = 0; i < v.played.length; i++) secs += v.played.end(i) - v.played.start(i)
  return Math.min(100, (secs / v.duration) * 100)
}

// ---- Player + gate + watch-time tracking ----
export default function VslVideo() {
  const [registered, setRegistered] = useState(Boolean(getLead()?.phone))
  const [stage, setStage] = useState('play') // play | form
  const [cfg, setCfg] = useState(null)
  const [vPlaying, setVPlaying] = useState(false)
  const [vMuted, setVMuted] = useState(false)
  const [bookReady, setBookReady] = useState(false) // booking unlocked
  const [isFs, setIsFs] = useState(false)           // player in fullscreen
  const videoRef = useRef(null)
  const vimeoWrapRef = useRef(null)
  const vimeoElRef = useRef(null)
  const vimeoPlayerRef = useRef(null)
  const fired = useRef({})
  const lastPercentSent = useRef(0)
  const latestPercent = useRef(0)
  const unlocked = useRef(false)

  useEffect(() => {
    const onChange = () => setRegistered(Boolean(getLead()?.phone))
    window.addEventListener('lead-changed', onChange)
    api.config()
      .then((c) => {
        setCfg(c)
        // a permanent Vimeo video always exists, so we never auto-unlock here
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

  // Push the exact current percent (used on pause / tab close so the admin
  // panel shows the precise watch time, not the last 5% step).
  function flushProgress(keepalive = false) {
    const phone = getLead()?.phone
    const pct = latestPercent.current
    if (!phone || pct - lastPercentSent.current < 0.5) return
    lastPercentSent.current = pct
    api.progress(phone, '', Math.round(pct), keepalive).catch(() => {})
  }

  useEffect(() => {
    const onHide = () => flushProgress(true)
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushProgress(true) }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pause the background video the moment the booking form opens. We don't
  // auto-resume on close — the viewer presses play to continue where they left.
  useEffect(() => {
    const onBookingOpen = () => {
      try { vimeoPlayerRef.current?.pause?.() } catch { /* ignore */ }
      try { videoRef.current?.pause?.() } catch { /* ignore */ }
      flushProgress()
    }
    window.addEventListener('open-booking', onBookingOpen)
    return () => window.removeEventListener('open-booking', onBookingOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track booking-unlock + fullscreen so the in-player "Book" button can show
  // (the page CTA is hidden while the player is fullscreen).
  useEffect(() => {
    const onUnlock = () => setBookReady(true)
    const onFs = () => setIsFs(Boolean(document.fullscreenElement))
    window.addEventListener('booking-unlock', onUnlock)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('booking-unlock', onUnlock)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [])

  // Booking from inside the player: leave fullscreen, then open the form.
  function bookFromPlayer() {
    if (document.fullscreenElement) document.exitFullscreen?.()
    openBooking('player-fullscreen')
  }

  const revealSeconds = cfg?.revealSeconds ?? 900
  const src = abs(cfg?.videoUrl) || ENV_SRC
  const poster = abs(cfg?.thumbUrl) || undefined
  // admin link overrides, else the permanent default (wait for cfg to load
  // so revealSeconds is settled and the player builds only once)
  const vimeoId = cfg ? (cfg.vimeoId || DEFAULT_VIMEO_ID) : null

  // When a Vimeo id is set, embed the player and wire the same watch-time
  // tracking (25/50/75/finished checkpoints, 5% steps, booking-unlock).
  // We build the iframe directly (reliable) and attach the SDK to it.
  useEffect(() => {
    const el = vimeoElRef.current
    if (!vimeoId || !el) return
    let player
    let alive = true
    el.innerHTML = ''
    const iframe = document.createElement('iframe')
    // controls=0 hides Vimeo's native bar — we draw our own (play/mute/full).
    iframe.src = `https://player.vimeo.com/video/${vimeoId}?controls=0&title=0&byline=0&portrait=0&dnt=1&playsinline=1`
    iframe.allow = 'autoplay; fullscreen; picture-in-picture'
    iframe.setAttribute('allowfullscreen', '')
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;'
    el.appendChild(iframe)

    loadVimeo().then((Vimeo) => {
      if (!alive || !Vimeo) return
      player = new Vimeo.Player(iframe)
      vimeoPlayerRef.current = player
      player.getMuted().then((m) => alive && setVMuted(m)).catch(() => {})
      player.on('play', () => setVPlaying(true))
      player.on('pause', () => { setVPlaying(false); flushProgress() })
      player.on('timeupdate', ({ seconds, percent }) => {
        const pct = Math.min(100, (percent || 0) * 100)
        latestPercent.current = Math.max(latestPercent.current, pct)
        if (pct >= 25) fire('25', pct)
        if (pct >= 50) fire('50', pct)
        if (pct >= 75) fire('75', pct)
        if (pct - lastPercentSent.current >= 5) { lastPercentSent.current = pct; fire('', pct) }
        if (seconds >= revealSeconds) unlockBooking(unlocked)
      })
      player.on('ended', () => { setVPlaying(false); latestPercent.current = 100; fire('finished', 100); unlockBooking(unlocked) })
    })
    return () => {
      alive = false
      try { player?.destroy?.() } catch { /* ignore */ }
      vimeoPlayerRef.current = null
      if (el) el.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vimeoId, revealSeconds])

  function onTimeUpdate(e) {
    const v = e.currentTarget
    if (v.duration) {
      const pct = playedPercent(v)
      latestPercent.current = Math.max(latestPercent.current, pct)
      // Milestones are relative to the video's length (work for any duration).
      if (pct >= 25) fire('25', pct)
      if (pct >= 50) fire('50', pct)
      if (pct >= 75) fire('75', pct)
      if (pct - lastPercentSent.current >= 5) { lastPercentSent.current = pct; fire('', pct) }
    }
    if (v.currentTime >= revealSeconds) unlockBooking(unlocked)
  }

  // register, then start playing the video (the Submit click is the user gesture)
  async function handleSubmit(name, phone) {
    const { phone: saved } = await api.register(name, phone)
    saveLead({ name, phone: saved })
    setRegistered(true)
    requestAnimationFrame(() => {
      if (vimeoId) vimeoPlayerRef.current?.play?.().catch(() => {})
      else videoRef.current?.play?.().catch(() => {})
    })
  }

  // ---- custom Vimeo controls: play / mute / fullscreen ----
  function vTogglePlay() {
    const p = vimeoPlayerRef.current
    if (!p) return
    if (vPlaying) p.pause().catch(() => {})
    else p.play().catch(() => {})
  }
  function vToggleMute() {
    const p = vimeoPlayerRef.current
    if (!p) return
    const next = !vMuted
    p.setMuted(next).then(() => setVMuted(next)).catch(() => {})
  }
  function vFullscreen() {
    const el = vimeoWrapRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen?.()
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)
  }

  return (
    <div className="video-frame">
      {vimeoId ? (
        <div className="vsl-vimeo-wrap" ref={vimeoWrapRef}>
          <div id="vsl-video" className="vsl-player vsl-vimeo" ref={vimeoElRef} />
          {bookReady && isFs && (
            <button type="button" className="vfx-book" onClick={bookFromPlayer}>
              Book my slot — ₹50 →
            </button>
          )}
          {registered && (
            <div className="vfx-bar">
              <button type="button" className="vfx-btn" onClick={vTogglePlay} aria-label={vPlaying ? 'Pause' : 'Play'}>
                {vPlaying ? (
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
              <button type="button" className="vfx-btn" onClick={vToggleMute} aria-label={vMuted ? 'Unmute' : 'Mute'}>
                {vMuted ? (
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4zm12.5 3L19 9.5 17.5 8 15 10.5 12.5 8 11 9.5 13.5 12 11 14.5 12.5 16 15 13.5 17.5 16 19 14.5z" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4zm11 .5a4 4 0 0 1 0 5v-5zm0-4.3v2.1a6 6 0 0 1 0 9.4v2.1a8 8 0 0 0 0-13.6z" /></svg>
                )}
              </button>
              <span className="vfx-spacer" />
              <button type="button" className="vfx-btn" onClick={vFullscreen} aria-label="Fullscreen">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
              </button>
            </div>
          )}
        </div>
      ) : src ? (
        <video
          id="vsl-video"
          className="vsl-player"
          ref={videoRef}
          src={src}
          poster={poster}
          controls={registered}
          controlsList="nodownload noplaybackrate noremoteplayback"
          disablePictureInPicture
          playsInline
          preload="metadata"
          onTimeUpdate={onTimeUpdate}
          onPause={() => flushProgress()}
          onEnded={() => { latestPercent.current = 100; fire('finished', 100); unlockBooking(unlocked) }}
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
                    <button type="button" onClick={() => fire('50', 50)}>50%</button>
                    <button type="button" onClick={() => { fire('75', 75); unlockBooking(unlocked) }}>75%</button>
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
