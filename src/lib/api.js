// Thin API client. In dev, calls go to /api and Vite proxies them to the
// backend (see vite.config.js). In prod set VITE_API_URL to the API origin.
const BASE = import.meta.env.VITE_API_URL || ''

// Traffic source: 'meta' when the visitor arrived from a Meta/Facebook ad
// (fbclid or a facebook/instagram utm_source), else 'whatsapp'. Stored first-
// touch so it survives in-session navigation.
function getSource() {
  try {
    const stored = localStorage.getItem('vsl_source')
    if (stored) return stored
    const p = new URLSearchParams(window.location.search)
    const utm = (p.get('utm_source') || '').toLowerCase()
    const isMeta = p.has('fbclid') || /facebook|instagram|meta|^ig$|^fb$/.test(utm)
      || (p.get('source') || '').toLowerCase() === 'meta'
    const src = isMeta ? 'meta' : 'whatsapp'
    localStorage.setItem('vsl_source', src)
    return src
  } catch { return 'whatsapp' }
}

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    let msg = `request failed (${res.status})`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  // public landing-page config (video, poster, booking-reveal time)
  config: () => req('/api/config'),

  // public proof / testimonial cards
  testimonials: () => req('/api/testimonials'),

  // Form 1
  register: (name, phone) =>
    req('/api/leads', { method: 'POST', body: JSON.stringify({ name, phone, source: getSource() }) }),

  // watch checkpoints. keepalive lets the final percent survive tab close.
  progress: (phone, checkpoint, percent, keepalive = false) =>
    req(`/api/leads/${encodeURIComponent(phone)}/progress`, {
      method: 'POST',
      body: JSON.stringify({ checkpoint, percent }),
      keepalive,
    }),

  // slots / Form 2
  slotDates: () => req('/api/slots/dates'),
  slotsForDate: (date) => req(`/api/slots?date=${encodeURIComponent(date)}`),
  holdSlot: (phone, name, date, time) =>
    req('/api/slots/hold', { method: 'POST', body: JSON.stringify({ phone, name, date, time }) }),

  // payment
  createOrder: (phone) =>
    req('/api/payment/order', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyPayment: (payload) =>
    req('/api/payment/verify', { method: 'POST', body: JSON.stringify(payload) }),
  paymentStatus: (phone, orderId, since) => {
    const qs = new URLSearchParams()
    if (orderId) qs.set('order', orderId)
    if (since) qs.set('since', String(since))
    const tail = qs.toString() ? `?${qs}` : ''
    return req(`/api/payment/status/${encodeURIComponent(phone)}${tail}`)
  },
}
