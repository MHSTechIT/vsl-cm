import { useEffect, useState, useCallback, useRef } from 'react'
import { adminApi, getToken, setToken, clearToken, getRole, setRole } from './adminApi.js'
import './admin.css'

const API_BASE = import.meta.env.VITE_API_URL || ''
const abs = (p) => (p ? `${API_BASE}${p}` : '')
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—')
// Permanent Vimeo id (matches the public site) — used to look up the video's
// total length so a lead's watch% can be shown as an actual mm:ss watch time.
const DEFAULT_VIMEO_ID = '1200466757'
// Leads table — rows shown per page.
const LEADS_PER_PAGE = 10
// percent watched × total video length → "mm:ss" (or "h:mm:ss" for long videos)
const fmtWatchTime = (percent, durationSec) => {
  if (!durationSec || percent == null) return '—'
  let secs = Math.round((Number(percent) / 100) * durationSec)
  const h = Math.floor(secs / 3600); secs -= h * 3600
  const m = Math.floor(secs / 60); const s = secs % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
const fmtDate = (iso) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'
// full timestamp (payment time) → "10 Jun, 11:38 am" in IST
const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
        hour12: true, timeZone: 'Asia/Kolkata',
      })
    : '—'

// ---------- tiny inline icons ----------
const Icon = {
  dashboard: <path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z" />,
  leads: <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.7 0-8 1.3-8 4v3h9v-3c0-1 .4-1.9 1-2.6A13 13 0 0 0 8 13zm8 0c-.3 0-.7 0-1.1.1A5 5 0 0 1 18 17v3h6v-3c0-2.7-5.3-4-8-4z" />,
  slots: <path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8v10H5V10h14z" />,
  settings: <path d="M19.4 13a7.8 7.8 0 0 0 .1-1 7.8 7.8 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1l-.4-2.5H9.1l-.4 2.5a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h5.8l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z" />,
  upload: <path d="M11 16V7.8L8.4 10.4 7 9l5-5 5 5-1.4 1.4L13 7.8V16h-2zM5 18h14v2H5v-2z" />,
  users: <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.7 0-8 1.3-8 4v3h9v-3c0-1 .4-1.9 1-2.6A13 13 0 0 0 8 13zm8 0c-.3 0-.7 0-1.1.1A5 5 0 0 1 18 17v3h6v-3c0-2.7-5.3-4-8-4z" />,
  wati: <path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.5 1.2 4.7 3.2 6.3L4 22l4.3-1.5c1.1.3 2.4.5 3.7.5 5.5 0 10-3.9 10-8.8S17.5 3 12 3z" />,
}
const NavIcon = ({ name }) => (
  <svg className="adm-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {Icon[name]}
  </svg>
)

// ---------- Custom dropdown (on-theme, replaces native <select>) ----------
function Dropdown({ value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const current = options.find((o) => o.value === value)
  return (
    <div className={`dd ${open ? 'is-open' : ''}`} ref={ref}>
      <button type="button" className="dd-btn" onClick={() => setOpen((o) => !o)}>
        <span>{current?.label}</span>
        <svg className="dd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="dd-menu" role="listbox">
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`dd-opt ${o.value === value ? 'is-active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Custom date picker (on-theme, replaces native date input) ----------
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
function DatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const base = value ? new Date(value + 'T00:00:00') : new Date()
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() })

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pad = (n) => String(n).padStart(2, '0')
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
  const t = new Date()
  const todayISO = iso(t.getFullYear(), t.getMonth(), t.getDate())
  const firstWd = (new Date(view.y, view.m, 1).getDay() + 6) % 7 // Monday-first
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const label = new Date(view.y, view.m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const move = (delta) => {
    let m = view.m + delta, y = view.y
    if (m < 0) { m = 11; y -= 1 } else if (m > 11) { m = 0; y += 1 }
    setView({ y, m })
  }
  const display = value ? value.split('-').reverse().join('-') : 'dd-mm-yyyy'
  const cells = []
  for (let i = 0; i < firstWd; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)

  return (
    <div className="dp" ref={ref}>
      <button type="button" className={`dp-input ${value ? '' : 'dp-empty'}`} onClick={() => setOpen((o) => !o)}>
        <span>{display}</span>
        <svg className="dp-cal" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8v10H5V10h14z" />
        </svg>
      </button>
      {open && (
        <div className="dp-pop">
          <div className="dp-head">
            <span className="dp-month">{label}</span>
            <div className="dp-nav">
              <button type="button" onClick={() => move(-1)} aria-label="Previous month">‹</button>
              <button type="button" onClick={() => move(1)} aria-label="Next month">›</button>
            </div>
          </div>
          <div className="dp-grid">
            {WEEKDAYS.map((d) => <span key={d} className="dp-wd">{d}</span>)}
          </div>
          <div className="dp-grid">
            {cells.map((d, i) => {
              if (!d) return <span key={i} />
              const cellISO = iso(view.y, view.m, d)
              const past = cellISO < todayISO
              return (
                <button
                  key={i}
                  type="button"
                  disabled={past}
                  className={`dp-day ${cellISO === value ? 'is-sel' : ''} ${cellISO === todayISO ? 'is-today' : ''}`}
                  onClick={() => { onChange(cellISO); setOpen(false) }}
                >{d}</button>
              )
            })}
          </div>
          <div className="dp-foot">
            <button type="button" className="dp-link" onClick={() => { onChange(''); setOpen(false) }}>Clear</button>
            <button type="button" className="dp-link" onClick={() => { onChange(todayISO); setOpen(false) }}>Today</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Login ----------
function Login({ onIn }) {
  const [mode, setMode] = useState('staff') // 'staff' (phone+password) | 'admin' (password)
  const [phone, setPhone] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'admin') {
        setToken(pw.trim())
        const me = await adminApi.me()
        setRole(me.role)
        onIn(me.role)
      } else {
        const r = await adminApi.login(phone.replace(/\D/g, ''), pw)
        setToken(r.token)
        setRole(r.role)
        onIn(r.role)
      }
    } catch {
      setErr(mode === 'admin' ? 'Wrong password. Please try again.' : 'Invalid phone or password.')
      setBusy(false)
    }
  }

  const switchMode = (m) => { setMode(m); setErr(''); setPw(''); setPhone('') }

  return (
    <div className="adm-login-wrap">
      <img className="adm-logo" src="/favicon.png" alt="My Health School" />
      <form className="adm-login" onSubmit={submit}>
        <div className="adm-login-head">
          <h1>{mode === 'admin' ? 'Super Admin Sign In' : 'Sign in'}</h1>
          <span className="adm-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l7 2.5V11c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V5.5L12 3z" />
            </svg>
            {mode === 'admin' ? 'ADMIN' : 'STAFF'}
          </span>
        </div>

        {mode === 'staff' && (
          <input
            className="adm-text-input"
            type="tel"
            inputMode="numeric"
            placeholder="Phone number"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}

        <div className="adm-pass">
          <input
            type={show ? 'text' : 'password'}
            placeholder="Password"
            autoFocus={mode === 'admin'}
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <button
            type="button"
            className="adm-eye"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
              {show && <line x1="4" y1="4" x2="20" y2="20" />}
            </svg>
          </button>
        </div>

        {err && <p className="adm-err">{err}</p>}

        <button type="submit" className="adm-signin" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In →'}
        </button>

        <div className="adm-login-foot">
          {mode === 'admin' ? (
            <button type="button" className="adm-back" onClick={() => switchMode('staff')}>← Staff login</button>
          ) : (
            <button type="button" className="adm-forgot" onClick={() => switchMode('admin')}>Admin login</button>
          )}
          <a className="adm-back" href="/">← Back to site</a>
        </div>
      </form>
    </div>
  )
}

// ---------- Dashboard ----------
function Dashboard() {
  const [s, setS] = useState(null)
  useEffect(() => { adminApi.stats().then(setS).catch(() => {}) }, [])

  return (
    <section className="adm-panel">
      <div className="adm-panel-head">
        <div>
          <h1 className="adm-h1">Overview</h1>
          <p className="adm-sub">{s ? `${s.registered} total registrations` : 'Loading…'}</p>
        </div>
      </div>

      {s && (
        <>
          <div className="adm-block">
            <h2 className="adm-h2">Drop-off funnel</h2>
            <FunnelPie
              stages={[
                { label: 'Registered', n: s.registered, of: s.registered, color: '#7c3aed' },
                { label: 'Watched 75%+', n: s.watch.m15, of: s.registered, color: '#f59e0b' },
                { label: 'Form 2 filled', n: s.form2, of: s.watch.m15, color: '#2563eb' },
                { label: 'Paid ₹50', n: s.paid, of: s.form2, color: '#059669' },
              ]}
            />
          </div>

          <div className="adm-block">
            <h2 className="adm-h2">Watch-time breakdown</h2>
            <div className="adm-watch">
              <span>25% <b>{s.watch.p25}</b></span>
              <span>50% <b>{s.watch.m8}</b></span>
              <span>75% <b>{s.watch.m15}</b></span>
              <span>finished <b>{s.watch.finished}</b></span>
            </div>
          </div>

          <div className="adm-block">
            <VideoRetention />
          </div>
        </>
      )}
    </section>
  )
}

// Catmull-Rom spline → a smooth cubic-bezier path through the given points.
function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length < 2) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

// Video retention — for each minute of the video, how many people watched at
// least that far. Computed client-side from each lead's max watch_percent ×
// the video's real length (Vimeo). Filterable by today / 7 days / 30 days.
function VideoRetention() {
  const [leads, setLeads] = useState([])
  const [duration, setDuration] = useState(0) // seconds
  const [range, setRange] = useState('today')

  useEffect(() => { adminApi.leads().then(setLeads).catch(() => {}) }, [])
  useEffect(() => {
    let alive = true
    adminApi.getConfig()
      .then((c) => c?.vimeoId || DEFAULT_VIMEO_ID)
      .catch(() => DEFAULT_VIMEO_ID)
      .then((id) =>
        fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${id}`)
          .then((r) => r.json())
          .then((j) => { if (alive && j?.duration) setDuration(j.duration) })
          .catch(() => {}),
      )
    return () => { alive = false }
  }, [])

  // range → "registered since" cutoff (today = local midnight)
  const sinceMs = (() => {
    const now = new Date()
    if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }
    if (range === 'week') return now.getTime() - 7 * 86400000
    return now.getTime() - 30 * 86400000
  })()

  const inRange = leads.filter((l) => l.registered_at && new Date(l.registered_at).getTime() >= sinceMs)
  const durMin = duration / 60
  const totalMin = durMin ? Math.max(1, Math.floor(durMin)) : 0

  // retention[m] = people whose furthest watch reached at least minute m
  const buckets = []
  for (let m = 1; m <= totalMin; m++) {
    const watchers = inRange.reduce((n, l) => {
      const watchedMin = ((Number(l.watch_percent) || 0) / 100) * durMin
      return watchedMin >= m ? n + 1 : n
    }, 0)
    buckets.push({ minute: m, count: watchers })
  }
  const maxCount = Math.max(1, ...buckets.map((b) => b.count))

  // SVG geometry
  const W = 720, H = 280, padL = 40, padR = 16, padT = 18, padB = 28
  const plotW = W - padL - padR, plotH = H - padT - padB
  const yTicks = [0, Math.round(maxCount / 2), maxCount].filter((v, i, a) => a.indexOf(v) === i)
  const xLabelEvery = totalMin > 16 ? 3 : totalMin > 8 ? 2 : 1

  // points along the curve (line spans the full plot width)
  const px = (m) => padL + (totalMin > 1 ? ((m - 1) / (totalMin - 1)) * plotW : plotW / 2)
  const py = (c) => padT + plotH - (c / maxCount) * plotH
  const pts = buckets.map((b) => ({ x: px(b.minute), y: py(b.count) }))
  // Catmull-Rom → cubic-bezier for a smooth single line through the points
  const linePath = smoothPath(pts)
  const areaPath = pts.length
    ? `${linePath} L ${pts[pts.length - 1].x} ${padT + plotH} L ${pts[0].x} ${padT + plotH} Z`
    : ''

  return (
    <>
      <div className="adm-chart-head">
        <h2 className="adm-h2">Video retention</h2>
        <Dropdown
          value={range}
          onChange={setRange}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'Weekly' },
            { value: 'month', label: 'Monthly' },
          ]}
        />
      </div>
      <p className="adm-sub adm-chart-sub">
        People still watching at each minute · <b>{inRange.length}</b> {range === 'today' ? 'today' : range === 'week' ? 'in 7 days' : 'in 30 days'}
      </p>

      {!duration ? (
        <p className="adm-empty">Loading video length…</p>
      ) : inRange.length === 0 ? (
        <p className="adm-empty">No registrations in this range.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="adm-retention" role="img" aria-label="Video retention by minute">
          <defs>
            <linearGradient id="rc-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
            <linearGradient id="rc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* light plot background to match the dashboard */}
          <rect x="0" y="0" width={W} height={H} rx="14" className="rc-bg" />

          {/* y gridlines + labels */}
          {yTicks.map((v) => {
            const y = padT + plotH - (v / maxCount) * plotH
            return (
              <g key={v}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} className="rc-grid" />
                <text x={padL - 8} y={y} className="rc-ylab" textAnchor="end" dominantBaseline="central">{v}</text>
              </g>
            )
          })}

          {/* area fill + gradient line */}
          {areaPath && <path d={areaPath} fill="url(#rc-fill)" stroke="none" />}
          <path d={linePath} className="rc-line" />
          {/* end-point dot */}
          {pts.length > 0 && (
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4.5" className="rc-dot" />
          )}

          {/* x labels (minute numbers) */}
          {buckets.filter((b) => b.minute % xLabelEvery === 0 || b.minute === 1).map((b) => (
            <text key={b.minute} x={px(b.minute)} y={H - 8} className="rc-xlab" textAnchor="middle">{b.minute}</text>
          ))}
        </svg>
      )}
      {duration > 0 && inRange.length > 0 && (
        <p className="adm-chart-axis">Minutes of video →</p>
      )}
    </>
  )
}
const Stat = ({ variant, value, label, tag }) => (
  <div className={`adm-stat adm-stat--${variant}`}>
    {tag && <span className="adm-stat-tag">● {tag}</span>}
    <div className="adm-stat-num">{value}</div>
    <div className="adm-stat-label">{label}</div>
  </div>
)

// Funnel as a donut: slices sized by lead count (share-of-total % inside each),
// with the funnel conversion-% (vs the previous stage) shown in the legend.
function FunnelPie({ stages }) {
  const total = stages.reduce((sum, st) => sum + st.n, 0)
  const cx = 120, cy = 120, r = 110, inner = 58
  const toXY = (deg, radius) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)]
  }
  const live = stages.filter((st) => st.n > 0)
  let angle = 0
  const arcs = live.map((st) => {
    const frac = st.n / total
    const start = angle
    const end = angle + frac * 360
    angle = end
    const mid = (start + end) / 2
    const [lx, ly] = toXY(mid, (r + inner) / 2)
    const full = frac >= 0.9999
    let d
    if (full) {
      // single full ring — draw it as two half-arcs so the donut closes
      const [ox, oy] = toXY(0, r); const [ix, iy] = toXY(0, inner)
      d = `M ${ox} ${oy} A ${r} ${r} 0 1 1 ${ox - 0.01} ${oy} Z `
        + `M ${ix} ${iy} A ${inner} ${inner} 0 1 0 ${ix - 0.01} ${iy} Z`
    } else {
      const [ox1, oy1] = toXY(start, r)
      const [ox2, oy2] = toXY(end, r)
      const [ix2, iy2] = toXY(end, inner)
      const [ix1, iy1] = toXY(start, inner)
      const large = frac > 0.5 ? 1 : 0
      d = `M ${ox1} ${oy1} A ${r} ${r} 0 ${large} 1 ${ox2} ${oy2} `
        + `L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`
    }
    return { ...st, d, lx, ly, share: Math.round(frac * 100), fillRule: full ? 'evenodd' : 'nonzero' }
  })

  if (!total) return <p className="adm-empty">No leads yet.</p>

  return (
    <div className="adm-pie">
      <svg viewBox="0 0 240 240" className="adm-pie-svg" role="img" aria-label="Funnel breakdown">
        {arcs.map((a) => (
          <path key={a.label} d={a.d} fill={a.color} fillRule={a.fillRule} stroke="#fff" strokeWidth="2" />
        ))}
        {arcs.filter((a) => a.share >= 7).map((a) => (
          <text key={a.label} x={a.lx} y={a.ly} className="adm-pie-pct"
            textAnchor="middle" dominantBaseline="central">{a.share}%</text>
        ))}
        <text x={cx} y={cy - 8} textAnchor="middle" className="adm-pie-center-num">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="adm-pie-center-label">touchpoints</text>
      </svg>

      <div className="adm-pie-legend">
        {stages.map((st, i) => (
          <div className="adm-pie-leg" key={st.label}>
            <span className="adm-pie-dot" style={{ background: st.color }} />
            <span className="adm-pie-leg-label">{st.label}</span>
            <span className="adm-pie-leg-num">{st.n}</span>
            <span className="adm-pie-leg-conv">{i === 0 ? '100%' : pct(st.n, st.of)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- HC status ----------
// Completed  — every HC field filled
// Pending    — form partially filled and submitted
// Overdue    — the booked slot has finished but the form isn't completed
// Not yet started — nothing filled yet
const HC_FIELDS = ['sugar_level', 'age', 'gender', 'l1_detox', 'professional', 'location', 'other_issues']
function hcStatusOf(r) {
  const hc = r.hc_data || null
  const filled = hc ? HC_FIELDS.filter((k) => String(hc[k] || '').trim()).length : 0
  if (filled === HC_FIELDS.length) return { label: 'Completed', c: 'green' }

  // has the booked slot already ended?
  let overdue = false
  if (r.slot_date && r.slot_time) {
    const end = String(r.slot_time).split('-')[1]?.trim() // e.g. "5.30pm"
    const m = end?.match(/(\d{1,2})\.(\d{2})\s*(am|pm)/i)
    if (m) {
      let h = Number(m[1])
      const min = Number(m[2])
      const pm = /pm/i.test(m[3])
      if (pm && h !== 12) h += 12
      if (!pm && h === 12) h = 0
      const t = Date.parse(`${r.slot_date}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+05:30`)
      if (!Number.isNaN(t) && Date.now() > t) overdue = true
    }
  }
  if (overdue) return { label: 'Overdue', c: 'red' }
  if (filled > 0) return { label: 'Pending', c: 'amber' }
  return { label: 'Not yet started', c: 'grey' }
}

// ---------- Leads ----------
function Leads() {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [hcEdit, setHcEdit] = useState(null) // the lead row being HC-edited
  const [duration, setDuration] = useState(0) // total video length (seconds)
  const [page, setPage] = useState(1) // current page (1-based)
  const load = useCallback(() => adminApi.leads().then(setRows).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  // Look up the video's total length once (admin Vimeo id, else the default)
  // so each lead's watch% can be rendered as a real mm:ss watch time.
  useEffect(() => {
    let alive = true
    adminApi.getConfig()
      .then((c) => c?.vimeoId || DEFAULT_VIMEO_ID)
      .catch(() => DEFAULT_VIMEO_ID)
      .then((id) =>
        fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${id}`)
          .then((r) => r.json())
          .then((j) => { if (alive && j?.duration) setDuration(j.duration) })
          .catch(() => {}),
      )
    return () => { alive = false }
  }, [])

  const filtered = rows.filter((r) => {
    if (q && !`${r.name} ${r.phone}`.toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'paid') return r.paid
    if (filter === 'unpaid') return !r.paid
    if (filter === 'needs-wa') return Boolean(r.needs_wa)
    if (filter === 'hold') return r.slot_status === 'pending'
    return true
  })

  // Paginate — 10 leads per page. Jump back to page 1 whenever the search or
  // filter changes so we never land on a now-empty page.
  useEffect(() => { setPage(1) }, [q, filter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / LEADS_PER_PAGE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * LEADS_PER_PAGE, safePage * LEADS_PER_PAGE)

  function exportCsv() {
    const head = ['Name', 'Phone', 'Pay phone', 'Watch%', 'Watch time', 'Form2', 'Slot date & time',
      'WA payment', 'WA 1-hr', 'Registered at', 'Payment status', 'HC status']
    const lines = filtered.map((r) => [
      r.name, r.phone, r.payment_phone || '', r.watch_percent,
      fmtWatchTime(r.watch_percent, duration),
      r.form2_submitted ? 'yes' : 'no',
      r.slot_date ? `${r.slot_date} ${r.slot_time}` : '',
      r.wa_payment || '',
      r.wa_1h_sent ? 'yes' : 'no',
      r.paid_at ? r.paid_at.slice(0, 19).replace('T', ' ') : '',
      r.payment_status || (r.paid ? 'success' : ''),
      hcStatusOf(r).label,
    ])
    const csv = [head, ...lines].map((row) => row.map((c) => `"${String(c ?? '')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'leads.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="adm-panel">
      <div className="adm-panel-head">
        <div>
          <h1 className="adm-h1">Lead registry</h1>
          <p className="adm-sub"><b>{rows.length}</b> total registrations</p>
        </div>
        <div className="adm-actions">
          <button className="adm-btn adm-btn-ghost" onClick={load}>Refresh</button>
          <button className="adm-btn adm-btn-primary" onClick={exportCsv}>↓ Export CSV</button>
        </div>
      </div>

      <div className="adm-filterbar">
        <input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <Dropdown
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All leads' },
            { value: 'paid', label: 'Paid' },
            { value: 'unpaid', label: 'Unpaid' },
            { value: 'needs-wa', label: 'Needs WhatsApp' },
            { value: 'hold', label: 'On hold' },
          ]}
        />
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Name</th><th>Phone</th><th>Pay phone</th><th>Watch</th><th>Watch time</th><th>Form 2</th>
              <th>Slot date &amp; time</th><th>WA payment</th><th>WA 1-hr</th>
              <th>Registered at</th><th>Payment status</th><th>HC status</th><th>Edit</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const payStatus = r.payment_status || (r.paid ? 'success' : null)
              return (
              <tr key={r.phone}>
                <td className="adm-strong">{r.name}</td>
                <td className="adm-mono">{r.phone}</td>
                <td className="adm-mono">{r.payment_phone || <span className="adm-dash">—</span>}</td>
                <td className="adm-mono">{r.watch_percent}%</td>
                <td className="adm-mono">{fmtWatchTime(r.watch_percent, duration)}</td>
                <td>{r.form2_submitted ? <Pill c="blue">Yes</Pill> : <span className="adm-dash">—</span>}</td>
                <td>{r.slot_date ? `${fmtDate(r.slot_date)} · ${r.slot_time}` : <span className="adm-dash">—</span>}</td>
                <td>
                  {r.wa_payment === 'success' ? <Pill c="green">Success</Pill>
                    : r.wa_payment === 'failed' ? <Pill c="red">Failed</Pill>
                    : <span className="adm-dash">—</span>}
                </td>
                <td>{r.wa_1h_sent ? <Pill c="green">Yes</Pill> : <Pill c="grey">No</Pill>}</td>
                <td>{r.paid_at ? fmtDateTime(r.paid_at) : <span className="adm-dash">—</span>}</td>
                <td>
                  {payStatus === 'success' ? <Pill c="green">Success</Pill>
                    : payStatus === 'failed' ? <Pill c="red">Failed</Pill>
                    : <span className="adm-dash">—</span>}
                </td>
                <td>{(() => { const h = hcStatusOf(r); return <Pill c={h.c}>{h.label}</Pill> })()}</td>
                <td>
                  <button className="hc-edit-btn" title="Edit health check" onClick={() => setHcEdit(r)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </button>
                </td>
              </tr>
              )
            })}
            {filtered.length === 0 && <tr><td colSpan="13" className="adm-empty">No leads yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="adm-pager">
          <span className="adm-pager-info">
            {(safePage - 1) * LEADS_PER_PAGE + 1}–{Math.min(safePage * LEADS_PER_PAGE, filtered.length)} of {filtered.length}
          </span>
          <div className="adm-pager-btns">
            <button className="adm-pager-btn" disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
            <span className="adm-pager-page">Page {safePage} / {pageCount}</span>
            <button className="adm-pager-btn" disabled={safePage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next →</button>
          </div>
        </div>
      )}

      {hcEdit && (
        <HcModal
          lead={hcEdit}
          onClose={() => setHcEdit(null)}
          onSaved={() => { setHcEdit(null); load() }}
        />
      )}
    </section>
  )
}
const Pill = ({ c, children }) => <span className={`pill pill-${c}`}>{children}</span>

// ---------- Health-check (HC) form modal ----------
function HcModal({ lead, onClose, onSaved }) {
  const hc = lead.hc_data || {}
  const [f, setF] = useState({
    name: lead.name || '',
    sugar_level: hc.sugar_level || '',
    age: hc.age || '',
    gender: hc.gender || '',
    l1_detox: hc.l1_detox || '',
    professional: hc.professional || '',
    location: hc.location || '',
    other_issues: hc.other_issues || '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await adminApi.saveHc(lead.phone, f)
      onSaved()
    } catch (e2) { setErr(e2.message); setBusy(false) }
  }

  const payStatus = lead.payment_status || (lead.paid ? 'success' : null)
  const details = [
    ['Phone', lead.phone],
    ['Pay phone', lead.payment_phone || '—'],
    ['Watch %', `${lead.watch_percent ?? 0}%`],
    ['Form 2', lead.form2_submitted ? 'Yes' : '—'],
    ['Slot', lead.slot_date ? `${fmtDate(lead.slot_date)} · ${lead.slot_time}` : '—'],
    ['WA payment', lead.wa_payment || '—'],
    ['WA 1-hr', lead.wa_1h_sent ? 'Yes' : 'No'],
    ['Registered at', lead.paid_at ? fmtDateTime(lead.paid_at) : '—'],
    ['Payment status', payStatus || '—'],
    ['HC status', hcStatusOf(lead).label],
  ]

  return (
    <div className="adm-overlay" onClick={onClose}>
      <div className="adm-dialog adm-dialog--wide hc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hc-head">
          <div>
            <span className="hc-eyebrow">Health check</span>
            <strong>{lead.name || lead.phone}</strong>
          </div>
          <button type="button" className="hc-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="hc-body">
          <div className="hc-details">
            {details.map(([k, v]) => (
              <div key={k}>
                <em>{k}</em>
                <span>{v}</span>
              </div>
            ))}
          </div>

          <form className="hc-form" onSubmit={submit}>
          <label>Name<input value={f.name} onChange={set('name')} /></label>
          <label>Phone number<input value={lead.phone} readOnly /></label>
          <label>Sugar level<input value={f.sugar_level} onChange={set('sugar_level')} placeholder="e.g. 250+" /></label>
          <label>Age<input value={f.age} onChange={set('age')} inputMode="numeric" /></label>
          <div className="hc-field">
            <span>Gender</span>
            <Dropdown
              value={f.gender}
              onChange={(v) => setF((s) => ({ ...s, gender: v }))}
              options={[
                { value: '', label: '—' },
                { value: 'Male', label: 'Male' },
                { value: 'Female', label: 'Female' },
                { value: 'Other', label: 'Other' },
              ]}
            />
          </div>
          <div className="hc-field">
            <span>L1 detox joined?</span>
            <Dropdown
              value={f.l1_detox}
              onChange={(v) => setF((s) => ({ ...s, l1_detox: v }))}
              options={[
                { value: '', label: '—' },
                { value: 'Joined', label: 'Joined' },
                { value: 'Not joined', label: 'Not joined' },
              ]}
            />
          </div>
          <label>Professional<input value={f.professional} onChange={set('professional')} /></label>
          <label>Location<input value={f.location} onChange={set('location')} /></label>
          <label className="hc-full">Any other health issues
            <textarea value={f.other_issues} onChange={set('other_issues')} rows={3} />
          </label>
          {err && <p className="reg-error hc-full">{err}</p>}
          <div className="hc-actions hc-full">
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Submit'}
            </button>
          </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ---------- Slots ----------
const fmtDot = (iso) => {
  const [y, m, d] = String(iso).split('-')
  return `${d}.${m}.${y}`
}

// One release group ("1st release" / "2nd release") of fake-booked slots.
// Chips can be moved to the other wave, opened immediately, and open slots
// can be blocked into this wave — full admin control over the drip order.
function ReleaseCard({ title, sub, slots, openSlots, moveLabel, onMove, onUnblock, onBlock }) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="rel-card">
      <div className="rel-head">
        <h4>{title}</h4>
        <span>{sub}</span>
      </div>
      <div className="rel-chips">
        {slots.length === 0 && <span className="rel-empty">no slots held back</span>}
        {slots.map((s) => (
          <span className="rel-chip" key={s.time}>
            <span className="rel-time">{s.time}{s.count > 1 ? ` ×${s.count}` : ''}</span>
            <button className="rel-act" title={`Move to ${moveLabel}`} onClick={() => onMove(s.time)}>
              {moveLabel}
            </button>
            <button className="rel-act rel-open" title="Open for booking now" onClick={() => onUnblock(s.time)}>
              open
            </button>
          </span>
        ))}
      </div>
      <div className="rel-addwrap">
        {adding ? (
          <div className="rel-addlist">
            {openSlots.length === 0 && <span className="rel-empty">no open slots to block</span>}
            {openSlots.map((s) => (
              <button key={s.time} className="rel-addopt" onClick={() => { onBlock(s.time); setAdding(false) }}>
                {s.time}
              </button>
            ))}
            <button className="rel-cancel" onClick={() => setAdding(false)}>cancel</button>
          </div>
        ) : (
          <button className="rel-add" onClick={() => setAdding(true)}>+ block a slot into this release</button>
        )}
      </div>
    </div>
  )
}

// Default day plan: twenty half-hour slots, 10.00am → 8.00pm.
function halfHourPreset(startHour = 10, endHour = 20) {
  const fmt = (h, m) => {
    const ap = h < 12 || h === 24 ? 'am' : 'pm'
    const hh = h % 12 === 0 ? 12 : h % 12
    return `${hh}.${m === 0 ? '00' : '30'}${ap}`
  }
  const out = []
  for (let h = startHour; h < endHour; h++) {
    out.push(`${fmt(h, 0)}-${fmt(h, 30)}`)
    out.push(`${fmt(h, 30)}-${fmt(h + 1, 0)}`)
  }
  return out
}

function Slots() {
  const [groups, setGroups] = useState([])
  const [date, setDate] = useState('')
  const [msg, setMsg] = useState('')
  const [seatEdit, setSeatEdit] = useState(null) // { date, time }
  const [seatList, setSeatList] = useState([])   // per-seat rows for the open slot
  const [seatBusy, setSeatBusy] = useState(false)
  const [seatErr, setSeatErr] = useState('')
  const [picker, setPicker] = useState(null)     // seat being manually assigned
  const load = useCallback(() => adminApi.slots().then(setGroups).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  const loadSeats = useCallback((d, t) => {
    setSeatErr('')
    return adminApi.slotSeats(d, t).then(setSeatList).catch(() => setSeatList([]))
  }, [])

  async function openDate(e) {
    e.preventDefault()
    setMsg('')
    const list = halfHourPreset() // fixed day plan — only the date is chosen
    if (!date) return setMsg('Pick a date first.')
    try {
      const r = await adminApi.openDate(date, list)
      setMsg(
        r.created
          ? `Opened ${r.created} seat(s) — ${r.blocked} shown as booked, released as payments come in.`
          : 'Those time slots are already open (day is at its 20-seat cap).',
      )
      load()
    }
    catch (e2) { setMsg(e2.message) }
  }
  function openSeats(d, s) {
    setSeatEdit({ date: d, time: s.time })
    setSeatList([])
    loadSeats(d, s.time)
  }
  function closeSeats() {
    setSeatEdit(null)
    setPicker(null)
    setSeatErr('')
    load() // refresh the grid counts
  }
  async function addSeat() {
    if (!seatEdit) return
    setSeatBusy(true); setSeatErr('')
    try { await adminApi.addSeat(seatEdit.date, seatEdit.time); await loadSeats(seatEdit.date, seatEdit.time) }
    catch (e) { setSeatErr(e.message) }
    finally { setSeatBusy(false) }
  }
  async function delSeat(seat) {
    if (!seatEdit) return
    setSeatBusy(true); setSeatErr('')
    try { await adminApi.freeSeat(seatEdit.date, seatEdit.time, seat.id); await loadSeats(seatEdit.date, seatEdit.time) }
    catch (e) { setSeatErr(e.message) }
    finally { setSeatBusy(false) }
  }
  async function assignLead(seat, phone) {
    setSeatBusy(true); setSeatErr('')
    try {
      await adminApi.assignSeat(seatEdit.date, seatEdit.time, seat.id, phone)
      setPicker(null)
      await loadSeats(seatEdit.date, seatEdit.time)
    } catch (e) { setSeatErr(e.message) }
    finally { setSeatBusy(false) }
  }
  async function removeTime(d, time) {
    if (!confirm(`Remove the ${time} slot?`)) return
    await adminApi.removeTime(d, time); load()
  }
  async function closeDate(d) {
    if (!confirm(`Remove all non-confirmed slots on ${fmtDot(d)}?`)) return
    await adminApi.closeDate(d); load()
  }
  const chipClass = (s) =>
    s.past ? 'past'
      : s.available > 0 ? 'available'
      : s.permanent > 0 ? 'permanent'
      : s.confirmed >= s.capacity ? 'confirmed' : 'pending'

  async function moveWave(d, time, wave) { await adminApi.setWave(d, time, wave); load() }
  async function unblock(d, time) { await adminApi.unblockSlot(d, time); load() }
  async function block(d, time, wave) {
    try { await adminApi.blockSlot(d, time, wave); load() }
    catch (e2) { setMsg(e2.message) }
  }

  return (
    <section className="adm-panel">
      <div className="adm-panel-head">
        <div><h1 className="adm-h1">Slot management</h1><p className="adm-sub">Open dates and manage the time slots shown on the booking form</p></div>
      </div>

      <form className="adm-openslot" onSubmit={openDate}>
        <DatePicker value={date} onChange={setDate} />
        <span className="adm-openslot-note">
          20 half-hour slots · 10.00am – 8.00pm · 10 open, 10 shown as booked
        </span>
        <button className="adm-btn adm-btn-primary" type="submit">+ Open date</button>
      </form>
      {msg && <p className="adm-msg">{msg}</p>}

      {groups.map((g) => (
        <div className="slot-day" key={g.date}>
          <div className="slot-day-head">
            <h3 className="slot-date">DATE : {fmtDot(g.date)}</h3>
            <button className="adm-link" onClick={() => closeDate(g.date)}>clear date</button>
          </div>
          <div className="slot-grid">
            {g.slots.map((s) => (
              <button
                className={`slot-chip slot-chip--${chipClass(s)}`}
                key={s.time}
                onClick={() => openSeats(g.date, s)}
                title="Click to set total seats"
              >
                <span className="slot-time">{s.time}</span>
                <span className="slot-seats">
                  {s.past ? (
                    <em className="slot-past">closed · time passed</em>
                  ) : (
                    <>
                      {s.available}/{s.capacity} left
                      {s.pending > 0 && <em className="slot-holding"> · {s.pending} holding (unpaid)</em>}
                      {s.blocked > 0 && <em className="slot-blocked"> · {s.blocked} shown booked</em>}
                      {s.permanent > 0 && <em className="slot-permanent"> · permanently booked</em>}
                    </>
                  )}
                </span>
                <span
                  className="slot-x"
                  onClick={(e) => { e.stopPropagation(); removeTime(g.date, s.time) }}
                  aria-label="Remove slot"
                >×</span>
              </button>
            ))}
          </div>

          <div className="slot-releases">
            <ReleaseCard
              title="1st release"
              sub="opens after 5 payments"
              slots={g.slots.filter((s) => s.wave1 > 0).map((s) => ({ time: s.time, count: s.wave1 }))}
              openSlots={g.slots.filter((s) => s.available > 0)}
              moveLabel="→ 2nd"
              onMove={(t) => moveWave(g.date, t, 2)}
              onUnblock={(t) => unblock(g.date, t)}
              onBlock={(t) => block(g.date, t, 1)}
            />
            <ReleaseCard
              title="2nd release"
              sub="opens after 10 payments"
              slots={g.slots.filter((s) => s.wave2 > 0).map((s) => ({ time: s.time, count: s.wave2 }))}
              openSlots={g.slots.filter((s) => s.available > 0)}
              moveLabel="→ 1st"
              onMove={(t) => moveWave(g.date, t, 1)}
              onUnblock={(t) => unblock(g.date, t)}
              onBlock={(t) => block(g.date, t, 2)}
            />
          </div>
        </div>
      ))}
      {groups.length === 0 && <p className="adm-empty">No dates open yet.</p>}

      {seatEdit && (
        <div className="adm-overlay" onClick={closeSeats}>
          <div className="adm-dialog adm-seat-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Total seats</h3>
            <p className="adm-dialog-sub">{seatEdit.time} — assign a lead, or <b>del</b> to remove a seat</p>
            {seatErr && <p className="adm-msg adm-seat-err">{seatErr}</p>}

            <div className="seat-rows">
              {seatList.map((seat, i) => (
                <div className="seat-row" key={seat.id}>
                  <span className="seat-row-name">
                    <b>{i + 1}</b>{' '}
                    {seat.leadName
                      ? <span className="seat-lead">{seat.leadName}{seat.locked && <em className="seat-paid"> · paid</em>}</span>
                      : <span className="seat-empty">( {seat.status === 'available' ? 'empty' : seat.status} )</span>}
                  </span>
                  <span className="seat-row-actions">
                    {!seat.locked && (
                      <button className="seat-manual" disabled={seatBusy} onClick={() => setPicker(seat)}>manual</button>
                    )}
                    {seat.locked
                      ? <span className="seat-locked" title="Real paid booking — protected">🔒</span>
                      : <button className="seat-del" disabled={seatBusy} onClick={() => delSeat(seat)}>del</button>}
                  </span>
                </div>
              ))}
              {seatList.length === 0 && <p className="adm-empty">No seats — add one below.</p>}
            </div>

            <div className="adm-dialog-actions">
              <button className="adm-btn adm-btn-ghost" onClick={closeSeats}>Cancel</button>
              <button className="adm-btn adm-btn-add" disabled={seatBusy} onClick={addSeat}>add</button>
              <button className="adm-btn adm-btn-primary" onClick={closeSeats}>Save</button>
            </div>
          </div>

          {picker && (
            <LeadPicker
              busy={seatBusy}
              onPick={(phone) => assignLead(picker, phone)}
              onClose={() => setPicker(null)}
            />
          )}
        </div>
      )}
    </section>
  )
}

// ---------- Lead picker (search + select a lead to manually book a seat) ----------
function LeadPicker({ onPick, onClose, busy }) {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => { adminApi.leads().then(setRows).catch(() => setRows([])) }, [])
  const filtered = rows.filter((r) =>
    !q || `${r.name} ${r.phone}`.toLowerCase().includes(q.toLowerCase()),
  )
  return (
    <div className="adm-overlay adm-overlay--nested" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="adm-dialog adm-picker" onClick={(e) => e.stopPropagation()}>
        <h3>Choose a lead</h3>
        <input
          className="seat-search"
          placeholder="Search name or phone"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="picker-rows">
          {filtered.map((r) => (
            <button key={r.phone} className="picker-row" disabled={busy} onClick={() => onPick(r.phone)}>
              <span className="picker-name">{r.name}</span>
              <span className="picker-phone">{r.phone}{r.paid && <em className="picker-paid"> · booked</em>}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="adm-empty">No leads match.</p>}
        </div>
        <div className="adm-dialog-actions">
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ---------- Upload ----------
const secsToMMSS = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const mmssToSecs = (v) => {
  const [m, s] = String(v).split(':').map((x) => parseInt(x, 10) || 0)
  return (m || 0) * 60 + (s || 0)
}

function UploadTileProgress({ p }) {
  return (
    <span className="up-tile-prog">
      <span className="up-tile-bar"><span style={{ width: `${p}%` }} /></span>
      {p < 100 ? `Uploading ${p}%` : 'Processing…'}
    </span>
  )
}

function Upload() {
  const [cfg, setCfg] = useState(null)
  const [reveal, setReveal] = useState('15:00')
  const [vimeo, setVimeo] = useState('')
  const [status, setStatus] = useState('')   // timing save
  const [vProg, setVProg] = useState(null)   // null = idle, else 0..100
  const [tProg, setTProg] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(
    () =>
      adminApi
        .getConfig()
        .then((c) => {
          setCfg(c)
          setReveal(secsToMMSS(c.revealSeconds ?? 900))
          setVimeo(c.vimeoId ? `https://vimeo.com/${c.vimeoId}` : '')
        })
        .catch(() => {}),
    [],
  )
  useEffect(() => { load() }, [load])

  // Upload a single file immediately on selection.
  async function uploadFile(kind, file, setProg) {
    if (!file) return
    setErr('')
    setProg(0)
    try {
      const fd = new FormData()
      fd.append(kind, file) // 'video' | 'thumb'
      await adminApi.saveConfig(fd, (p) => setProg(p))
      await load() // refresh the stored filename / preview
    } catch (e) {
      setErr(`${kind === 'video' ? 'Video' : 'Thumbnail'} upload failed: ${e.message}`)
    } finally {
      setProg(null)
    }
  }

  async function saveTiming() {
    setStatus('saving')
    try {
      const fd = new FormData()
      fd.append('revealSeconds', String(mmssToSecs(reveal)))
      fd.append('vimeoUrl', vimeo.trim())
      await adminApi.saveConfig(fd)
      setStatus('saved')
      load()
    } catch (e) { setStatus(e.message) }
  }

  const thumbPreview = cfg?.thumbId ? abs(`/media/${cfg.thumbId}`) : null
  const busy = vProg != null || tProg != null

  return (
    <section className="adm-panel">
      <div className="adm-panel-head">
        <div>
          <h1 className="adm-h1">Upload</h1>
          <p className="adm-sub">Video &amp; thumbnail upload as soon as you choose them. Save stores the booking timing.</p>
        </div>
      </div>

      <div className="up-cardgrid">
        <div className="up-card">
          <div className="up-row">
            {/* video — uploads on select */}
            <label className="up-tile">
              <input type="file" accept="video/*" hidden disabled={vProg != null}
                onChange={(e) => uploadFile('video', e.target.files[0], setVProg)} />
              <span className="up-tile-title">Video</span>
              {vProg != null ? (
                <UploadTileProgress p={vProg} />
              ) : (
                <span className="up-tile-sub">
                  {cfg?.videoId ? '✓ uploaded — click to replace' : 'Click to upload'}
                </span>
              )}
            </label>

            {/* thumbnail — uploads on select */}
            <label className="up-tile up-tile--thumb"
              style={thumbPreview && tProg == null ? { backgroundImage: `url(${thumbPreview})` } : undefined}>
              <input type="file" accept="image/*" hidden disabled={tProg != null}
                onChange={(e) => uploadFile('thumb', e.target.files[0], setTProg)} />
              {tProg != null ? (
                <UploadTileProgress p={tProg} />
              ) : !thumbPreview ? (
                <>
                  <span className="up-tile-title">Thumbnail</span>
                  <span className="up-tile-sub">Click to upload</span>
                </>
              ) : null}
            </label>
          </div>

          {err && <p className="reg-error" style={{ textAlign: 'center' }}>{err}</p>}

          {/* Vimeo link — when set, the page plays from Vimeo (off the database) */}
          <div className="up-vimeo">
            <span className="up-reveal-label">Vimeo video link</span>
            <input
              className="reg-input"
              value={vimeo}
              onChange={(e) => setVimeo(e.target.value)}
              placeholder="https://vimeo.com/123456789  (leave blank to use the uploaded file)"
            />
            <span className="up-vimeo-hint">
              When set, the landing page streams from Vimeo instead of the database — recommended.
            </span>
          </div>

          {/* booking-reveal time */}
          <div className="up-reveal">
            <span className="up-reveal-label">Booking button appears at</span>
            <input
              className="up-reveal-input"
              value={reveal}
              onChange={(e) => setReveal(e.target.value)}
              placeholder="mm:ss"
            />
          </div>

          <button className="adm-btn adm-btn-primary up-save" onClick={saveTiming} disabled={status === 'saving' || busy}>
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {status && status !== 'saving' && (
        <p className="adm-msg">{status === 'saved' ? 'Saved ✓' : status}</p>
      )}

      <TestimonialManager />
    </section>
  )
}

// ---------- Proof / testimonial cards ----------
function TestimonialManager() {
  const blank = { name: '', body: '', before: '', after: '', statText: '', today: '' }
  const [list, setList] = useState([])
  const [f, setF] = useState(blank)
  const [img, setImg] = useState(null)
  const [status, setStatus] = useState('')

  const load = useCallback(() => adminApi.listTestimonials().then(setList).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function add(e) {
    e.preventDefault()
    if (!f.name.trim()) { setStatus('Name line is required'); return }
    setStatus('saving')
    try {
      const fd = new FormData()
      fd.append('name', f.name)
      fd.append('body', f.body)
      fd.append('statBefore', f.before)
      fd.append('statAfter', f.after)
      fd.append('statText', f.statText)
      fd.append('today', f.today)
      if (img) fd.append('image', img)
      await adminApi.addTestimonial(fd)
      setF(blank); setImg(null)
      await load()
      setStatus('added')
    } catch (e2) { setStatus(e2.message) }
  }
  async function del(id) {
    if (!confirm('Delete this card?')) return
    await adminApi.deleteTestimonial(id)
    load()
  }

  return (
    <div className="up-cardgrid up-cardgrid--split">
      <div className="up-card up-card--wide">
        <h2 className="adm-h2">Proof cards</h2>
        <p className="adm-sub" style={{ marginTop: 0, marginBottom: 14 }}>
          These show in the landing page "Real people. Real results." section.
        </p>

        <form className="tm-form" onSubmit={add}>
          <input className="reg-input" placeholder="Name line — e.g. Rajan, 47 — software professional, Chennai"
            value={f.name} onChange={set('name')} />
          <textarea className="reg-input tm-textarea" placeholder="Description — e.g. Diabetes for 8 years. Was on Metformin…"
            value={f.body} onChange={set('body')} />
          <div className="tm-row">
            <input className="reg-input" placeholder="HbA1c before (9.2)" value={f.before} onChange={set('before')} />
            <input className="reg-input" placeholder="HbA1c after (5.8)" value={f.after} onChange={set('after')} />
          </div>
          <input className="reg-input" placeholder="Or custom stat text (optional)" value={f.statText} onChange={set('statText')} />
          <textarea className="reg-input tm-textarea" placeholder="Today line — e.g. Today: all tablets stopped…"
            value={f.today} onChange={set('today')} />
          <label className="tm-imgpick">
            <input type="file" accept="image/*" hidden onChange={(e) => setImg(e.target.files[0] || null)} />
            {img ? img.name : 'Upload blood-report image (optional)'}
          </label>
          <button className="adm-btn adm-btn-primary" type="submit" disabled={status === 'saving'}>
            {status === 'saving' ? 'Saving…' : 'Add card'}
          </button>
          {status && !['saving', 'added'].includes(status) && <p className="reg-error">{status}</p>}
          {status === 'added' && <p className="adm-msg">Added ✓</p>}
        </form>
      </div>

      <div className="up-card up-card--list">
        <h2 className="adm-h2">Added cards ({list.length})</h2>
        {list.length === 0 ? (
          <p className="adm-sub" style={{ marginTop: 0 }}>No cards yet — add the first one on the left.</p>
        ) : (
          <div className="tm-list">
            {list.map((t) => (
              <div className="tm-item" key={t.id}>
                {t.imageUrl ? (
                  <img className="tm-thumb" src={abs(t.imageUrl)} alt="" />
                ) : (
                  <span className="tm-thumb tm-thumb--empty">📋</span>
                )}
                <div className="tm-meta">
                  <span className="adm-strong">{t.name}</span>
                  <span className="tm-stat">
                    {t.statText || (t.statBefore && t.statAfter ? `HbA1c ${t.statBefore} → ${t.statAfter}` : '')}
                  </span>
                </div>
                <button className="adm-link" onClick={() => del(t.id)}>delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Users ----------
function Users() {
  const [list, setList] = useState([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { kind, text }

  const [editUser, setEditUser] = useState(null) // account being edited
  const [delUser, setDelUser] = useState(null)   // account pending delete confirm

  const load = useCallback(() => adminApi.users().then(setList).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  async function create(e) {
    e.preventDefault()
    setMsg(null)
    if (!name.trim()) return setMsg({ kind: 'err', text: 'Enter a name.' })
    if (phone.replace(/\D/g, '').length < 8) return setMsg({ kind: 'err', text: 'Enter a valid phone number.' })
    if (pw.length < 4) return setMsg({ kind: 'err', text: 'Password must be at least 4 characters.' })
    if (pw !== pw2) return setMsg({ kind: 'err', text: 'Passwords do not match.' })
    setBusy(true)
    try {
      await adminApi.createUser(name.trim(), phone, pw)
      setName(''); setPhone(''); setPw(''); setPw2('')
      setMsg({ kind: 'ok', text: 'Account created.' })
      load()
    } catch (e2) {
      setMsg({ kind: 'err', text: e2.message })
    } finally { setBusy(false) }
  }
  async function confirmDelete() {
    if (!delUser) return
    await adminApi.deleteUser(delUser.id)
    setDelUser(null)
    load()
  }

  return (
    <section className="adm-panel">
      <div className="adm-panel-head">
        <div>
          <h1 className="adm-h1">Users</h1>
          <p className="adm-sub"><b>{list.length}</b> account{list.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div className="up-cardgrid up-cardgrid--split">
        <div className="up-card up-card--wide">
          <h2 className="adm-h2">Create an account</h2>
          <form className="tm-form" onSubmit={create}>
            <input className="reg-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="reg-input" type="tel" inputMode="numeric" placeholder="Phone number"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div className="adm-pass">
              <input className="reg-input" type={show ? 'text' : 'password'} placeholder="Password"
                value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              <button type="button" className="adm-eye" onClick={() => setShow((v) => !v)} aria-label="Toggle password">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" />
                  {show && <line x1="4" y1="4" x2="20" y2="20" />}
                </svg>
              </button>
            </div>
            <input className="reg-input" type={show ? 'text' : 'password'} placeholder="Re-enter password"
              value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            <button className="adm-btn adm-btn-primary" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
            {msg && <p className={msg.kind === 'ok' ? 'adm-msg' : 'reg-error'} style={{ margin: 0 }}>{msg.text}</p>}
          </form>
        </div>

        <div className="up-card up-card--list">
          <h2 className="adm-h2">Accounts ({list.length})</h2>
          {list.length === 0 ? (
            <p className="adm-sub" style={{ marginTop: 0 }}>No accounts yet — create the first one on the left.</p>
          ) : (
            <div className="tm-list">
              {list.map((u) => (
                <div className="tm-item" key={u.id}>
                  <div className="tm-meta">
                    <span className="adm-strong">{u.name}</span>
                    <span className="tm-stat">{u.phone}</span>
                  </div>
                  <div className="usr-actions">
                    <button className="hc-edit-btn" title="Edit account" onClick={() => setEditUser(u)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                      </svg>
                    </button>
                    <button className="adm-link" onClick={() => setDelUser(u)}>delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editUser && (
        <UserEditModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => { setEditUser(null); load() }}
        />
      )}

      {delUser && (
        <div className="adm-overlay" onClick={() => setDelUser(null)}>
          <div className="adm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete account?</h3>
            <p className="adm-dialog-sub">
              This permanently deletes the account for <b>{delUser.name}</b> ({delUser.phone}).
            </p>
            <div className="adm-dialog-actions">
              <button className="adm-btn adm-btn-ghost" onClick={() => setDelUser(null)}>Cancel</button>
              <button className="adm-btn adm-btn-danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ---------- Edit-user modal ----------
function UserEditModal({ user, onClose, onSaved }) {
  const [name, setName] = useState(user.name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save(e) {
    e.preventDefault()
    setErr('')
    if (!name.trim()) return setErr('Enter a name.')
    if (phone.replace(/\D/g, '').length < 8) return setErr('Enter a valid phone number.')
    if (pw && pw.length < 4) return setErr('Password must be at least 4 characters.')
    if (pw && pw !== pw2) return setErr('Passwords do not match.')
    setBusy(true)
    try {
      await adminApi.updateUser(user.id, name.trim(), phone, pw)
      onSaved()
    } catch (e2) { setErr(e2.message); setBusy(false) }
  }

  return (
    <div className="adm-overlay" onClick={onClose}>
      <div className="adm-dialog adm-dialog--form" onClick={(e) => e.stopPropagation()}>
        <h3>Edit account</h3>
        <p className="adm-dialog-sub">{user.name}</p>
        <form className="tm-form" onSubmit={save}>
          <input className="reg-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="reg-input" type="tel" inputMode="numeric" placeholder="Phone number"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div className="adm-pass">
            <input className="reg-input" type={show ? 'text' : 'password'}
              placeholder="New password (leave blank to keep current)"
              value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <button type="button" className="adm-eye" onClick={() => setShow((v) => !v)} aria-label="Toggle password">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" />
                {show && <line x1="4" y1="4" x2="20" y2="20" />}
              </svg>
            </button>
          </div>
          {pw && (
            <input className="reg-input" type={show ? 'text' : 'password'} placeholder="Re-enter new password"
              value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          )}
          {err && <p className="reg-error" style={{ margin: 0 }}>{err}</p>}
          <div className="adm-dialog-actions">
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------- WATI inbox (WhatsApp-web-style) ----------
const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  }) : ''

function WatiChat() {
  const [convos, setConvos] = useState([])
  const [configured, setConfigured] = useState(true)
  const [active, setActive] = useState(null)   // wa_id
  const [activeName, setActiveName] = useState('')
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const bottomRef = useRef(null)

  const loadConvos = useCallback(() => {
    adminApi.waConversations().then((d) => {
      setConvos(d.conversations || [])
      setConfigured(d.watiConfigured)
    }).catch(() => {})
  }, [])
  const loadMsgs = useCallback((id) => {
    if (!id) return
    adminApi.waMessages(id).then(setMsgs).catch(() => {})
  }, [])

  // poll conversations every 5s; messages of the open thread every 3s
  useEffect(() => { loadConvos(); const t = setInterval(loadConvos, 5000); return () => clearInterval(t) }, [loadConvos])
  useEffect(() => {
    if (!active) return
    loadMsgs(active)
    const t = setInterval(() => loadMsgs(active), 3000)
    return () => clearInterval(t)
  }, [active, loadMsgs])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  function openChat(c) { setActive(c.wa_id); setActiveName(c.name || ''); setErr('') }

  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body || !active) return
    setSending(true); setErr('')
    try {
      const r = await adminApi.waSend(active, body)
      setMsgs((m) => [...m, r.message])
      setText('')
      loadConvos()
    } catch (e2) { setErr(e2.message) }
    finally { setSending(false) }
  }

  const shown = convos.filter((c) =>
    !q || `${c.name || ''} ${c.wa_id}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <section className="adm-panel wa-panel">
      <div className="adm-panel-head">
        <div>
          <h1 className="adm-h1">WhatsApp inbox</h1>
          <p className="adm-sub">
            {configured ? 'Replies go to the customer’s WhatsApp via WATI.' : 'WATI not configured — set WATI_TOKEN + WATI_BASE_URL.'}
          </p>
        </div>
      </div>

      <div className="wa-wrap">
        <aside className="wa-list">
          <input className="wa-search" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
          {shown.length === 0 && <p className="adm-empty" style={{ fontSize: '0.85rem' }}>No conversations yet.</p>}
          {shown.map((c) => (
            <button key={c.wa_id} className={`wa-conv ${active === c.wa_id ? 'is-active' : ''}`} onClick={() => openChat(c)}>
              <span className="wa-avatar">{(c.name || c.wa_id || '?').slice(0, 1).toUpperCase()}</span>
              <span className="wa-conv-body">
                <span className="wa-conv-top">
                  <b>{c.name || c.wa_id}</b>
                  <em>{fmtTime(c.created_at).split(',')[0]}</em>
                </span>
                <span className="wa-conv-snip">{c.direction === 'out' ? 'You: ' : ''}{c.text}</span>
              </span>
            </button>
          ))}
        </aside>

        <div className="wa-thread">
          {!active ? (
            <div className="wa-empty">Select a conversation to start chatting.</div>
          ) : (
            <>
              <div className="wa-thread-head">
                <span className="wa-avatar">{(activeName || active).slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{activeName || active}</strong>
                  <span className="adm-mono wa-thread-num">{active}</span>
                </div>
              </div>
              <div className="wa-msgs">
                {msgs.map((m) => (
                  <div key={m.id} className={`wa-bubble wa-${m.direction}`}>
                    <span>{m.text}</span>
                    <em>{fmtTime(m.created_at)}</em>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              {err && <p className="reg-error" style={{ margin: '0 12px' }}>{err}</p>}
              <form className="wa-compose" onSubmit={send}>
                <input placeholder="Type a reply…" value={text} onChange={(e) => setText(e.target.value)} disabled={!configured} />
                <button className="adm-btn adm-btn-primary" type="submit" disabled={sending || !configured || !text.trim()}>
                  {sending ? '…' : 'Send'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// ---------- Settings ----------
function Settings() {
  const [s, setS] = useState(null)
  const [sheet, setSheet] = useState(null)   // { googleConfigured, url, linked, lastSync }
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState('')        // '' | 'save' | 'sync'
  const [msg, setMsg] = useState(null)        // { kind, text }

  const loadSheet = useCallback(
    () => adminApi.sheets().then((d) => { setSheet(d); setUrl(d.url || '') }).catch(() => {}),
    [],
  )
  useEffect(() => {
    adminApi.settings().then(setS).catch(() => {})
    loadSheet()
  }, [loadSheet])

  async function saveSheet() {
    setBusy('save'); setMsg(null)
    try {
      const r = await adminApi.saveSheet(url.trim())
      setMsg({ kind: 'ok', text: url.trim() ? `Saved & synced ${r.synced} lead(s) to the sheet.` : 'Sheet link cleared.' })
      loadSheet()
    } catch (e) { setMsg({ kind: 'err', text: e.message }) }
    finally { setBusy('') }
  }
  async function syncNow() {
    setBusy('sync'); setMsg(null)
    try {
      const r = await adminApi.syncSheet()
      setMsg({ kind: 'ok', text: `Synced ${r.synced} lead(s) to the sheet.` })
      loadSheet()
    } catch (e) { setMsg({ kind: 'err', text: e.message }) }
    finally { setBusy('') }
  }

  return (
    <section className="adm-panel">
      <div className="adm-panel-head"><div><h1 className="adm-h1">Settings</h1></div></div>

      <div className="adm-block">
        <h2 className="adm-h2">Google Sheet export</h2>
        <p className="adm-sub" style={{ marginTop: 0, marginBottom: 14 }}>
          Paste your Google Sheet link — every lead from the Leads page is mirrored here,
          and the sheet updates automatically on each new registration and payment.
        </p>
        <div className="adm-filterbar" style={{ marginBottom: 10 }}>
          <input
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <button className="adm-btn adm-btn-primary" onClick={saveSheet} disabled={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : 'Save & sync'}
          </button>
          {sheet?.linked && (
            <button className="adm-btn adm-btn-ghost" onClick={syncNow} disabled={busy === 'sync'}>
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
        {msg && (
          <p className={msg.kind === 'ok' ? 'adm-msg' : 'reg-error'} style={{ margin: '0 0 8px' }}>{msg.text}</p>
        )}
        {sheet && (
          <div className="adm-settings">
            <p>Google account <b>{sheet.googleConfigured ? 'connected' : 'not configured (set OAuth in .env)'}</b></p>
            <p>Sheet <b>{sheet.linked ? 'linked' : 'not linked'}</b></p>
            {sheet.lastSync && <p>Last sync <b>{new Date(sheet.lastSync).toLocaleString('en-IN')}</b></p>}
          </div>
        )}
      </div>

      {s && (
        <div className="adm-block adm-settings">
          <p>Hold window <b>{s.holdWindowMinutes} min</b> <span className="adm-dash">(set in server .env)</span></p>
          <p>Razorpay mode <b>{s.razorpayMode}</b></p>
          <p>WhatsApp (Whapi) <b>{s.whapiConnected ? 'connected' : 'manual-flag mode'}</b></p>
        </div>
      )}
    </section>
  )
}

// ---------- Shell ----------
const ADMIN_NAV = [
  { id: 'dashboard', label: 'Overview' },
  { id: 'leads', label: 'Leads' },
  { id: 'users', label: 'Users' },
  { id: 'wati', label: 'WATI' },
  { id: 'slots', label: 'Slots' },
  { id: 'upload', label: 'Upload' },
  { id: 'settings', label: 'Settings' },
]
const STAFF_NAV = [
  { id: 'leads', label: 'Leads' },
  { id: 'wati', label: 'WATI' },
]

export default function Admin() {
  const [authed, setAuthed] = useState(false)
  const [role, setRoleState] = useState(getRole())
  const [tab, setTab] = useState('leads')

  // start tab on the right default for the role
  const enter = (r) => {
    setRoleState(r)
    setTab(r === 'admin' ? 'dashboard' : 'leads')
    setAuthed(true)
  }
  const signOut = () => { clearToken(); setAuthed(false); setRoleState('') }

  useEffect(() => {
    if (!getToken()) return
    adminApi.me()
      .then((me) => { setRole(me.role); enter(me.role) })
      .catch(() => { clearToken(); setAuthed(false) })
  }, [])

  if (!authed) return <Login onIn={enter} />

  const nav = role === 'admin' ? ADMIN_NAV : STAFF_NAV

  return (
    <div className="adm-shell">
      <aside className="adm-side">
        <div className="adm-brand">
          <img src="/favicon.png" alt="" />
          <div>
            <strong>My Health School</strong>
            <span>{role === 'admin' ? 'Admin panel' : 'Staff'}</span>
          </div>
        </div>

        <nav className="adm-nav">
          {nav.map((n) => (
            <button key={n.id} className={tab === n.id ? 'is-active' : ''} onClick={() => setTab(n.id)}>
              <NavIcon name={n.id} />
              {n.label}
            </button>
          ))}
        </nav>

        <button className="adm-signout" onClick={signOut}>
          Sign out
        </button>
      </aside>

      <main className="adm-content">
        {tab === 'dashboard' && role === 'admin' && <Dashboard />}
        {tab === 'leads' && <Leads />}
        {tab === 'users' && role === 'admin' && <Users />}
        {tab === 'wati' && <WatiChat />}
        {tab === 'slots' && role === 'admin' && <Slots />}
        {tab === 'upload' && role === 'admin' && <Upload />}
        {tab === 'settings' && role === 'admin' && <Settings />}
      </main>
    </div>
  )
}
