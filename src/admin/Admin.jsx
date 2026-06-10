import { useEffect, useState, useCallback, useRef } from 'react'
import { adminApi, getToken, setToken, clearToken } from './adminApi.js'
import './admin.css'

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
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setErr('')
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
      <form className="adm-login" onSubmit={submit}>
        <img className="adm-logo" src="/favicon.png" alt="My Health School" />
        <h1>Admin panel</h1>
        <p className="adm-login-sub">Enter your password to continue</p>
        <input
          type="password"
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          value={tok}
          onChange={(e) => setTok(e.target.value)}
        />
        {err && <p className="adm-err">{err}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
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
          <div className="adm-cards">
            <Stat variant="purple" value={s.registered} label="Registered to watch" tag="ALL" />
            <Stat variant="amber" value={s.watch.m15} label="Watched 15 min" />
            <Stat variant="blue" value={s.form2} label="Form 2 filled" />
            <Stat variant="green" value={s.paid} label="Paid ₹99" />
          </div>

          <div className="adm-block">
            <h2 className="adm-h2">Drop-off funnel</h2>
            {[
              { label: 'Registered', n: s.registered, of: s.registered },
              { label: 'Watched 15 min', n: s.watch.m15, of: s.registered },
              { label: 'Form 2 filled', n: s.form2, of: s.watch.m15 },
              { label: 'Paid ₹99', n: s.paid, of: s.form2 },
            ].map((f, i) => (
              <div className="adm-funnel-row" key={f.label}>
                <span className="adm-funnel-label">{f.label}</span>
                <div className="adm-bar">
                  <div className="adm-bar-fill" style={{ width: `${(f.n / Math.max(s.registered, 1)) * 100}%` }} />
                </div>
                <span className="adm-funnel-num">{f.n} <em>{i === 0 ? '100%' : pct(f.n, f.of)}</em></span>
              </div>
            ))}
          </div>

          <div className="adm-block">
            <h2 className="adm-h2">Watch-time breakdown</h2>
            <div className="adm-watch">
              <span>25% <b>{s.watch.p25}</b></span>
              <span>8-min <b>{s.watch.m8}</b></span>
              <span>15-min <b>{s.watch.m15}</b></span>
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
                <td>{r.phone}</td>
                <td>{r.watch_percent}%</td>
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

function Slots() {
  const [groups, setGroups] = useState([])
  const [date, setDate] = useState('')
  const [times, setTimes] = useState('8.00am-9.00am, 9.00am-10.00am, 10.00am-11.00am')
  const [msg, setMsg] = useState('')
  const [seatEdit, setSeatEdit] = useState(null) // { date, time }
  const [seatVal, setSeatVal] = useState('')
  const load = useCallback(() => adminApi.slots().then(setGroups).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  async function openDate(e) {
    e.preventDefault()
    setMsg('')
    const list = times.split(',').map((t) => t.trim()).filter(Boolean)
    if (!date || !list.length) return setMsg('Pick a date and at least one time slot.')
    try { await adminApi.openDate(date, list); setMsg(`Opened ${list.length} slot(s).`); load() }
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

  return (
    <section className="adm-panel">
      <div className="adm-panel-head">
        <div><h1 className="adm-h1">Slot management</h1><p className="adm-sub">Open dates and manage the time slots shown on the booking form</p></div>
      </div>

      <form className="adm-openslot" onSubmit={openDate}>
        <DatePicker value={date} onChange={setDate} />
        <input type="text" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="time slots, comma separated" />
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
                <span className="slot-seats">{s.available}/{s.capacity} left</span>
                <span
                  className="slot-x"
                  onClick={(e) => { e.stopPropagation(); removeTime(g.date, s.time) }}
                  aria-label="Remove slot"
                >×</span>
              </button>
            ))}
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

function Upload() {
  const [cfg, setCfg] = useState(null)
  const [video, setVideo] = useState(null)
  const [thumb, setThumb] = useState(null)
  const [reveal, setReveal] = useState('15:00')
  const [status, setStatus] = useState('')

  const load = useCallback(
    () =>
      adminApi
        .getConfig()
        .then((c) => { setCfg(c); setReveal(secsToMMSS(c.revealSeconds ?? 900)) })
        .catch(() => {}),
    [],
  )
  useEffect(() => { load() }, [load])

  const thumbPreview = thumb
    ? URL.createObjectURL(thumb)
    : cfg?.thumbFile ? `/uploads/${cfg.thumbFile}` : null

  async function save() {
    setStatus('saving')
    try {
      const fd = new FormData()
      if (video) fd.append('video', video)
      if (thumb) fd.append('thumb', thumb)
      fd.append('revealSeconds', String(mmssToSecs(reveal)))
      await adminApi.saveConfig(fd)
      setVideo(null); setThumb(null)
      await load()
      setStatus('saved')
    } catch (e) { setStatus(e.message) }
  }

  return (
    <section className="adm-panel">
      <div className="adm-panel-head">
        <div>
          <h1 className="adm-h1">Upload</h1>
          <p className="adm-sub">Set the landing-page video, thumbnail, and booking-button timing</p>
        </div>
      </div>

      <div className="up-cardgrid">
        <div className="up-card">
          <div className="up-row">
            {/* video */}
            <label className="up-tile">
              <input type="file" accept="video/*" hidden onChange={(e) => setVideo(e.target.files[0] || null)} />
              <span className="up-tile-title">Video</span>
              <span className="up-tile-sub">
                {video ? video.name : cfg?.videoFile ? `Current: ${cfg.videoFile}` : 'Click to upload'}
              </span>
            </label>
            {/* thumbnail */}
            <label
              className="up-tile up-tile--thumb"
              style={thumbPreview ? { backgroundImage: `url(${thumbPreview})` } : undefined}
            >
              <input type="file" accept="image/*" hidden onChange={(e) => setThumb(e.target.files[0] || null)} />
              {!thumbPreview && (
                <>
                  <span className="up-tile-title">Thumbnail</span>
                  <span className="up-tile-sub">Click to upload</span>
                </>
              )}
            </label>
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

          <button className="adm-btn adm-btn-primary up-save" onClick={save} disabled={status === 'saving'}>
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
    <div className="up-cardgrid">
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

        {list.length > 0 && (
          <div className="tm-list">
            {list.map((t) => (
              <div className="tm-item" key={t.id}>
                <span className="adm-strong">{t.name}</span>
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
