import { useEffect, useState, useCallback, useRef } from 'react'
import { adminApi, getToken, setToken, clearToken } from './adminApi.js'
import './admin.css'

const API_BASE = import.meta.env.VITE_API_URL || ''
const abs = (p) => (p ? `${API_BASE}${p}` : '')
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—')
const fmtDate = (iso) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'

// ---------- tiny inline icons ----------
const Icon = {
  dashboard: <path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z" />,
  leads: <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.7 0-8 1.3-8 4v3h9v-3c0-1 .4-1.9 1-2.6A13 13 0 0 0 8 13zm8 0c-.3 0-.7 0-1.1.1A5 5 0 0 1 18 17v3h6v-3c0-2.7-5.3-4-8-4z" />,
  slots: <path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8v10H5V10h14z" />,
  settings: <path d="M19.4 13a7.8 7.8 0 0 0 .1-1 7.8 7.8 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1l-.4-2.5H9.1l-.4 2.5a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h5.8l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z" />,
  upload: <path d="M11 16V7.8L8.4 10.4 7 9l5-5 5 5-1.4 1.4L13 7.8V16h-2zM5 18h14v2H5v-2z" />,
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
  const [tok, setTok] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setErr('')
    setNote('')
    setBusy(true)
    setToken(tok.trim())
    try {
      await adminApi.stats()
      onIn()
    } catch {
      setErr('Wrong password. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="adm-login-wrap">
      <img className="adm-logo" src="/favicon.png" alt="My Health School" />
      <form className="adm-login" onSubmit={submit}>
        <div className="adm-login-head">
          <h1>Super Admin Sign In</h1>
          <span className="adm-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l7 2.5V11c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V5.5L12 3z" />
            </svg>
            ADMIN
          </span>
        </div>

        <div className="adm-pass">
          <input
            type={show ? 'text' : 'password'}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
            value={tok}
            onChange={(e) => setTok(e.target.value)}
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
        {note && <p className="adm-note">{note}</p>}

        <button type="submit" className="adm-signin" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In →'}
        </button>

        <div className="adm-login-foot">
          <button
            type="button"
            className="adm-forgot"
            onClick={() => setNote('Contact the site owner to reset the admin password.')}
          >
            Forgot password?
          </button>
          <a className="adm-back" href="/">← Back to user login</a>
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
        </>
      )}
    </section>
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

// ---------- Leads ----------
function Leads() {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const load = useCallback(() => adminApi.leads().then(setRows).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  const filtered = rows.filter((r) => {
    if (q && !`${r.name} ${r.phone}`.toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'paid') return r.paid
    if (filter === 'unpaid') return !r.paid
    if (filter === 'needs-wa') return Boolean(r.needs_wa)
    if (filter === 'hold') return r.slot_status === 'pending'
    return true
  })

  function exportCsv() {
    const head = ['Name', 'Phone', 'Watch%', 'Form2', 'Slot', 'Status', 'Registered']
    const lines = filtered.map((r) => [
      r.name, r.phone, r.watch_percent,
      r.form2_submitted ? 'yes' : 'no',
      r.slot_date ? `${r.slot_date} ${r.slot_time}` : '',
      r.paid ? 'paid' : r.slot_status || '',
      r.registered_at?.slice(0, 10),
    ])
    const csv = [head, ...lines].map((row) => row.map((c) => `"${String(c ?? '')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'leads.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function markWa(phone) { await adminApi.waSent(phone); load() }

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
              <th>Name</th><th>Phone</th><th>Watch</th><th>Form 2</th>
              <th>Slot</th><th>Status</th><th>Registered</th><th>WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.phone}>
                <td className="adm-strong">{r.name}</td>
                <td className="adm-mono">{r.phone}</td>
                <td className="adm-mono">{r.watch_percent}%</td>
                <td>{r.form2_submitted ? <Pill c="blue">Yes</Pill> : <span className="adm-dash">—</span>}</td>
                <td>{r.slot_date ? `${fmtDate(r.slot_date)} · ${r.slot_time}` : <span className="adm-dash">—</span>}</td>
                <td>
                  {r.paid ? <Pill c="green">Paid</Pill>
                    : r.slot_status === 'pending' ? <Pill c="amber">Hold</Pill>
                    : <span className="adm-dash">—</span>}
                </td>
                <td>{fmtDate(r.registered_at?.slice(0, 10))}</td>
                <td>
                  {r.needs_wa
                    ? <button className="adm-wa" onClick={() => markWa(r.phone)}>send · {r.needs_wa}</button>
                    : <span className="adm-dash">—</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan="8" className="adm-empty">No leads yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
const Pill = ({ c, children }) => <span className={`pill pill-${c}`}>{children}</span>

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
  const [seatVal, setSeatVal] = useState('')
  const load = useCallback(() => adminApi.slots().then(setGroups).catch(() => {}), [])
  useEffect(() => { load() }, [load])

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
    setSeatVal(String(s.capacity))
  }
  async function saveSeats() {
    const seats = Math.round(Number(seatVal))
    if (Number.isFinite(seats) && seats >= 1) {
      await adminApi.setSeats(seatEdit.date, seatEdit.time, seats)
      load()
    }
    setSeatEdit(null)
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
    s.available > 0 ? 'available' : s.confirmed >= s.capacity ? 'confirmed' : 'pending'

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
                  {s.available}/{s.capacity} left
                  {s.blocked > 0 && <em className="slot-blocked"> · {s.blocked} shown booked</em>}
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
        <div className="adm-overlay" onClick={() => setSeatEdit(null)}>
          <div className="adm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Total seats</h3>
            <p className="adm-dialog-sub">{seatEdit.time}</p>
            <input
              type="number"
              min="1"
              value={seatVal}
              autoFocus
              onChange={(e) => setSeatVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveSeats() }}
            />
            <div className="adm-dialog-actions">
              <button className="adm-btn adm-btn-ghost" onClick={() => setSeatEdit(null)}>Cancel</button>
              <button className="adm-btn adm-btn-primary" onClick={saveSeats}>Save</button>
            </div>
          </div>
        </div>
      )}
    </section>
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
  const [status, setStatus] = useState('')   // timing save
  const [vProg, setVProg] = useState(null)   // null = idle, else 0..100
  const [tProg, setTProg] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(
    () =>
      adminApi
        .getConfig()
        .then((c) => { setCfg(c); setReveal(secsToMMSS(c.revealSeconds ?? 900)) })
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
      await adminApi.saveConfig(fd)
      setStatus('saved')
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

// ---------- Settings ----------
function Settings() {
  const [s, setS] = useState(null)
  useEffect(() => { adminApi.settings().then(setS).catch(() => {}) }, [])
  return (
    <section className="adm-panel">
      <div className="adm-panel-head"><div><h1 className="adm-h1">Settings</h1></div></div>
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
export default function Admin() {
  const [authed, setAuthed] = useState(Boolean(getToken()))
  const [tab, setTab] = useState('dashboard')

  useEffect(() => {
    if (!getToken()) return
    adminApi.stats().then(() => setAuthed(true)).catch(() => { clearToken(); setAuthed(false) })
  }, [])

  if (!authed) return <Login onIn={() => setAuthed(true)} />

  const nav = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'leads', label: 'Leads' },
    { id: 'slots', label: 'Slots' },
    { id: 'upload', label: 'Upload' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="adm-shell">
      <aside className="adm-side">
        <div className="adm-brand">
          <img src="/favicon.png" alt="" />
          <div>
            <strong>My Health School</strong>
            <span>Admin panel</span>
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

        <button className="adm-signout" onClick={() => { clearToken(); setAuthed(false) }}>
          Sign out
        </button>
      </aside>

      <main className="adm-content">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'leads' && <Leads />}
        {tab === 'slots' && <Slots />}
        {tab === 'upload' && <Upload />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  )
}
