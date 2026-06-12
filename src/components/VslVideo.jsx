import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getLead, saveLead } from '../lib/session.js'
import { openBooking } from '../lib/booking.js'
import { trackRegistered, trackVideo15Min } from '../lib/tracking.js'

const ENV_SRC = import.meta.env.VITE_VSL_SRC || '' // optional fallback
const API_BASE = import.meta.env.VITE_API_URL || '' // prefix for /uploads in prod
const abs = (path) => (path ? `${API_BASE}${path}` : '')

// Permanent VSL video (hosted on Vimeo). Always used unless an admin Vimeo
// link explicitly overrides it — so the page never streams video from the DB.
const DEFAULT_VIMEO_ID = '1200466757'

// Permanent video poster/thumbnail. Served as a static asset from /public, so
// it is fixed in code and the admin panel / DB can never change it.
const PERMANENT_POSTER = '/thumbnail.jpeg'

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
    if (!name.trim()) {
      setErr('Please enter your name.')
      return
    }
    // Indian mobile: require 10 digits starting 6–9. Only strip a leading 0/91
    // country code when EXTRA digits are present — never from a bare 10-digit
    // number (e.g. 9176xxxxxx legitimately starts with "91").
    let local = phone.replace(/\D/g, '')
    if (local.length > 10) local = local.replace(/^(0+|91)/, '')
    if (!/^[6-9]\d{9}$/.test(local)) {
      setErr('Enter a valid 10-digit mobile number.')
      return
    }
    if (/^(\d)\1{9}$/.test(local)) {
      setErr('Please enter your real WhatsApp number.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(name.trim(), local)
    } catch (e2) {
      setErr(e2.message || 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <form className="reg-gate" onSubmit={submit}>
      <p className="reg-gate-title">Login To Watch The Training Video</p>
      <input className="reg-input" type="text" placeholder="Your name" value={name}
        onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
      <input className="reg-input" type="tel" inputMode="numeric" placeholder="WhatsApp number" value={phone}
        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
        maxLength={10} autoComplete="tel" />
      {err && <p className="reg-error">{err}</p>}
      <button type="submit" className="cta reg-submit" disabled={busy}>
        {busy ? 'Please wait…' : 'Watch Now'}
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
  const [started, setStarted] = useState(false) // first play happened → hide poster
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
  // Cumulative *actual* watch time (sums continuous playback only, so pauses
  // and forward seeks aren't counted) → fires the Video15Min pixel once at 900s.
  const watchedSeconds = useRef(0)
  const lastTick = useRef(null)
  const video15Fired = useRef(false)

  // Accumulate real watch time from a timeupdate position, then fire at 900s.
  function accrueWatch(pos) {
    if (lastTick.current != null) {
      const delta = pos - lastTick.current
      if (delta > 0 && delta < 2) watchedSeconds.current += delta // continuous play only
    }
    lastTick.current = pos
    if (!video15Fired.current && watchedSeconds.current >= 900) {
      video15Fired.current = true
      trackVideo15Min()
    }
  }

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
  const poster = PERMANENT_POSTER // fixed in code — admin/DB cannot override it
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
      player.on('play', () => { setVPlaying(true); setStarted(true) })
      player.on('pause', () => { setVPlaying(false); lastTick.current = null; flushProgress() })
      player.on('timeupdate', ({ seconds, percent }) => {
        const pct = Math.min(100, (percent || 0) * 100)
        latestPercent.current = Math.max(latestPercent.current, pct)
        accrueWatch(seconds)
        if (pct >= 25) fire('25', pct)
        if (pct >= 50) fire('50', pct)
        if (pct >= 75) fire('75', pct)
        if (pct - lastPercentSent.current >= 5) { lastPercentSent.current = pct; fire('', pct) }
        if (seconds >= revealSeconds) unlockBooking(unlocked)
      })
      player.on('ended', () => {
        setVPlaying(false); lastTick.current = null; latestPercent.current = 100
        fire('finished', 100); unlockBooking(unlocked)
        // Re-cover the player with the poster so Vimeo's "More from / related
        // videos" end screen never shows. Reset so the play button reappears.
        setStarted(false)
        try { vimeoPlayerRef.current?.unload?.() } catch { /* ignore */ }
      })
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
    accrueWatch(v.currentTime)
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

  // Start playback INSIDE the tap so iOS allows sound. iOS only honours an
  // unmuted play() that runs synchronously within the user gesture — any await
  // (network) or requestAnimationFrame first makes it "autoplay", which iOS is
  // forced to mute. So we play (unmuted) first, then register in the background.
  function handleSubmit(name, phone) {
    saveLead({ name, phone }) // optimistic — so watch-time tracking has the phone
    setRegistered(true)
    trackRegistered() // Form 1 submitted → video unlocks

    if (vimeoId) {
      const p = vimeoPlayerRef.current
      try { p?.setMuted?.(false); p?.setVolume?.(1) } catch { /* ignore */ }
      p?.play?.().catch(() => {})
    } else {
      videoRef.current?.play?.().catch(() => {})
    }
    // Persist the lead without blocking the gesture (don't await before play).
    api.register(name, phone)
      .then(({ phone: saved }) => saveLead({ name, phone: saved }))
      .catch(() => {})
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
          {!started && (
            <div className="vsl-vimeo-poster" style={{ backgroundImage: `url(${poster})` }} aria-hidden="true" />
          )}
          {registered && !started && (
            <button type="button" className="vfx-play-center" aria-label="Play video"
              onClick={() => {
                const p = vimeoPlayerRef.current
                try { p?.setMuted?.(false); p?.setVolume?.(1) } catch { /* ignore */ }
                p?.play?.().catch(() => {})
              }}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              <span>Play Video</span>
            </button>
          )}
          {bookReady && isFs && (
            <button type="button" className="vfx-book" onClick={bookFromPlayer}>
              Book my slot — ₹50 →
            </button>
          )}
          {registered && (
            <div className="vfx-bar">
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
          onPause={() => { lastTick.current = null; flushProgress() }}
          onEnded={() => { lastTick.current = null; latestPercent.current = 100; fire('finished', 100); unlockBooking(unlocked) }}
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
              <span>Play Video</span>
            </button>
          ) : (
            <RegistrationGate onSubmit={handleSubmit} />
          )}
        </div>
      )}
    </div>
  )
}
