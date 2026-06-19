// Thin API client. In dev, calls go to /api and Vite proxies them to the
// backend (see vite.config.js). In prod set VITE_API_URL to the API origin.
import { getFunnel } from './funnel.js'

const BASE = import.meta.env.VITE_API_URL || ''
const FUNNEL = getFunnel() // 'paid' | 'free' — tags every funnel-scoped call

// Traffic source + (for Meta ads) which campaign/ad the visitor came from.
// source is 'meta' when they arrived from a Meta/Facebook ad (fbclid or a
// facebook/instagram utm_source), else 'whatsapp'. detail is the readable
// "Campaign › Ad" name pulled from the ad's URL parameters — set these up on
// the Meta ad as  utm_campaign={{campaign.name}}&utm_content={{ad.name}}
// (Meta auto-fills those macros). Captured first-touch so it survives
// in-session navigation.
function getTrafficInfo() {
  try {
    const cached = localStorage.getItem('vsl_traffic')
    if (cached) return JSON.parse(cached)
    const p = new URLSearchParams(window.location.search)
    const utm = (p.get('utm_source') || '').toLowerCase()
    const isMeta = p.has('fbclid') || /facebook|instagram|meta|^ig$|^fb$/.test(utm)
      || (p.get('source') || '').toLowerCase() === 'meta'
    const source = isMeta ? 'meta' : 'whatsapp'
    let detail = null
    if (isMeta) {
      const dec = (s) => (s ? decodeURIComponent(String(s).replace(/\+/g, ' ')).trim() : '')
      const campaign = dec(p.get('utm_campaign') || p.get('campaign') || p.get('campaign_name'))
      const ad = dec(p.get('utm_content') || p.get('ad') || p.get('ad_name') || p.get('utm_term'))
      const parts = [campaign, ad].filter(Boolean)
      detail = parts.length ? parts.join(' › ') : null
    }
    const info = { source, detail }
    localStorage.setItem('vsl_traffic', JSON.stringify(info))
    return info
  } catch { return { source: 'whatsapp', detail: null } }
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
  funnel: FUNNEL,

  // public landing-page config (video, poster, booking-reveal time)
  config: () => req(`/api/config?funnel=${FUNNEL}`),

  // public proof / testimonial cards
  testimonials: () => req(`/api/testimonials?funnel=${FUNNEL}`),

  // Form 1
  register: (name, phone) => {
    const t = getTrafficInfo()
    return req('/api/leads', {
      method: 'POST',
      body: JSON.stringify({ name, phone, source: t.source, sourceDetail: t.detail, funnel: FUNNEL }),
    })
  },

  // watch checkpoints. keepalive lets the final percent survive tab close.
  progress: (phone, checkpoint, percent, keepalive = false) =>
    req(`/api/leads/${encodeURIComponent(phone)}/progress`, {
      method: 'POST',
      body: JSON.stringify({ checkpoint, percent }),
      keepalive,
    }),

  // slots / Form 2
  slotDates: () => req(`/api/slots/dates?funnel=${FUNNEL}`),
  slotsForDate: (date) =>
    req(`/api/slots?date=${encodeURIComponent(date)}&funnel=${FUNNEL}`),
  holdSlot: (phone, name, date, time) =>
    req('/api/slots/hold', {
      method: 'POST',
      body: JSON.stringify({ phone, name, date, time, funnel: FUNNEL }),
    }),

  // free funnel — confirm the held slot directly (no payment)
  freeConfirm: (phone) =>
    req('/api/slots/free-confirm', { method: 'POST', body: JSON.stringify({ phone }) }),

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
