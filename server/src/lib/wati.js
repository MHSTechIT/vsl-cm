import { config } from '../config.js'

// ============================================================
// WATI template sender. Fires the approved utility templates:
//   payment_success · payment_failed_ · one_hour
// Needs WATI_TOKEN + WATI_BASE_URL (your tenant endpoint, e.g.
// https://live-mt-server.wati.io/{tenantId}). No-ops cleanly until set.
// ============================================================

export function watiConfigured() {
  return Boolean(config.wati.token && config.wati.baseUrl)
}

// WATI wants the full international number, no '+': 91XXXXXXXXXX.
function toWati(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  return d.length === 10 ? `91${d}` : d
}

// Send a template. `params` is an ordered list of values for the template's
// {{1}}, {{2}}… placeholders (WATI names them "1", "2", …). Adjust the values
// once the templates are approved and we see their exact variables.
export async function sendTemplate(phone, templateName, paramValues = []) {
  if (!watiConfigured()) return { sent: false, skipped: 'wati-not-configured' }
  const num = toWati(phone)
  if (!num) return { sent: false, skipped: 'bad-phone' }

  const base = config.wati.baseUrl.replace(/\/$/, '')
  const url = `${base}/api/v1/sendTemplateMessage?whatsappNumber=${num}`
  const parameters = paramValues.map((value, i) => ({ name: String(i + 1), value: String(value ?? '') }))

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.wati.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      template_name: templateName,
      broadcast_name: `${templateName}_${num}`,
      parameters,
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`WATI ${res.status}: ${t.slice(0, 200)}`)
  }
  return { sent: true }
}

// Free-form session reply (WhatsApp 24-hour customer-care window). Used by the
// inbox chat page. Delivers only if the customer messaged within 24h — outside
// that window WhatsApp requires a template, and WATI returns result:false.
export async function sendSessionMessage(phone, text) {
  if (!watiConfigured()) throw new Error('WATI is not configured (set WATI_TOKEN + WATI_BASE_URL)')
  const num = toWati(phone)
  if (!num) throw new Error('invalid phone')
  const base = config.wati.baseUrl.replace(/\/$/, '')
  const url = `${base}/api/v1/sendSessionMessage/${num}?messageText=${encodeURIComponent(text)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.wati.token}` },
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.result === false) {
    throw new Error(j.info || j.message || `WATI ${res.status} — message not sent (24h window may have closed)`)
  }
  return { sent: true }
}

// Payment-success / booking-confirmation template (mhs_welcome_video):
// {{1}} = customer name. Falls back to a neutral greeting so WATI never gets a
// blank variable (which it rejects with a 400).
export const watiPaymentSuccess = (phone, { name } = {}) =>
  sendTemplate(phone, config.wati.templates.paymentSuccess, [String(name || '').trim() || 'there'])

// 1-hour-before-slot reminder (one_hour_togo): {{1}} = name, {{2}} = date, {{3}} = time.
export const watiOneHour = (phone, { name, date, time } = {}) =>
  sendTemplate(phone, config.wati.templates.oneHour, [String(name || '').trim() || 'there', date, time])

// Internal alert (lead finished the video) — ALWAYS to the fixed leadAlertPhone,
// never the customer: {{1}} = lead name, {{2}} = lead phone.
export const watiLeadAlert = ({ name, phone } = {}) =>
  sendTemplate(config.wati.leadAlertPhone, config.wati.templates.leadAlert, [name, phone])
