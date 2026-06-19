import crypto from 'node:crypto'
import { config } from '../config.js'
import { query } from '../db.js'
import { getSettings, setSetting } from './settings.js'

// ============================================================
// Google Sheets export — mirrors the Leads registry into a sheet.
// Service-account JWT flow (no per-request login, no expiring refresh token).
// Plain REST via fetch, so no extra npm dependency.
// ============================================================

export function isConfigured() {
  const g = config.google
  return Boolean(g.serviceAccountEmail && g.serviceAccountKey)
}

// Pull the spreadsheet id out of a full URL (or accept a bare id).
export function spreadsheetIdFromUrl(url) {
  const s = String(url || '').trim()
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : null
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

// Mint a short-lived access token by signing a JWT with the service-account
// private key (RS256) and exchanging it at Google's token endpoint.
async function accessToken() {
  const { serviceAccountEmail, serviceAccountKey } = config.google
  if (!serviceAccountEmail || !serviceAccountKey) {
    throw new Error('Google service account is not configured on the server')
  }
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claim}`
  let signature
  try {
    signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(serviceAccountKey)
  } catch (e) {
    throw new Error(`Google auth failed — bad service-account private key (${e.message})`)
  }
  const jwt = `${unsigned}.${b64url(signature)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.access_token) {
    const detail = j.error_description || j.error || `${res.status}`
    throw new Error(`Google auth failed (${detail}) — check the service account key and that the Sheets API is enabled`)
  }
  return j.access_token
}

const HEADER = [
  'Name', 'Phone', 'Pay phone', 'Watch %', 'Form 2', 'Slot date & time',
  'WA payment', 'WA 1-hr', 'Registered at (paid)', 'Payment status', 'Converted',
]
const ts = (v) => (v ? String(v).slice(0, 19).replace('T', ' ') : '')

function rowFor(l) {
  return [
    l.name || '',
    l.phone || '',
    l.payment_phone || '',
    l.watch_percent ?? 0,
    l.form2_submitted ? 'yes' : 'no',
    l.slot_date ? `${String(l.slot_date).slice(0, 10)} ${l.slot_time || ''}`.trim() : '',
    l.wa_payment || '',
    l.wa_1h_sent ? 'yes' : 'no',
    ts(l.paid_at),
    l.payment_status || (l.paid ? 'success' : ''),
    l.converted ? 'yes' : 'no',
  ]
}

async function sheets(path, token, method, body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Sheets API ${res.status}: ${t.slice(0, 160)}`)
  }
  return res.json().catch(() => ({}))
}

// Overwrite the linked sheet with the full leads registry (newest first).
export async function syncLeadsToSheet() {
  const { sheets_url: url } = await getSettings(['sheets_url'])
  const id = spreadsheetIdFromUrl(url)
  if (!id) throw new Error('No Google Sheet linked — paste the sheet link in Settings first')

  const token = await accessToken()
  const { rows } = await query(
    `SELECT phone, name, watch_percent, form2_submitted, slot_date, slot_time,
            paid, paid_at, payment_phone, payment_status, wa_payment, wa_1h_sent, converted
       FROM leads ORDER BY registered_at DESC`,
  )
  const values = [HEADER, ...rows.map(rowFor)]

  // clear the old data, then write the fresh set (first sheet/tab)
  await sheets(`/${id}/values/A:Z:clear`, token, 'POST', {})
  await sheets(`/${id}/values/A1?valueInputOption=RAW`, token, 'PUT', { range: 'A1', values })
  await setSetting('sheets_last_sync', new Date().toISOString())
  return rows.length
}

// Fire-and-forget — used after a new lead / payment so the sheet stays live.
// Silently no-ops when Google or the sheet link isn't set up yet.
export async function syncLeadsToSheetSafe() {
  try {
    if (!isConfigured()) return
    const { sheets_url: url } = await getSettings(['sheets_url'])
    if (!spreadsheetIdFromUrl(url)) return
    await syncLeadsToSheet()
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sheets] auto-sync skipped:', e.message)
  }
}
