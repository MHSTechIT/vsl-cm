import { Router } from 'express'
import { query } from '../db.js'
import { ah } from '../lib/ah.js'
import { syncLeadsToSheetSafe } from '../lib/google-sheets.js'

export const leadsRouter = Router()

// FORM 1 — registration gate. Creates (or returns) the lead, keyed by phone.
leadsRouter.post(
  '/',
  ah(async (req, res) => {
    const name = String(req.body?.name || '').trim()
    const phone = normalizePhone(req.body?.phone)
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' })
    // 'meta' when the visitor arrived from a Meta/FB ad; else WhatsApp/organic.
    const source = String(req.body?.source || '') === 'meta' ? 'meta' : null

    await query(
      `INSERT INTO leads (phone, name, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name,
              source = COALESCE(leads.source, EXCLUDED.source), updated_at = now()`,
      [phone, name, source],
    )
    res.json({ ok: true, phone })
    syncLeadsToSheetSafe() // keep the linked Google Sheet live (fire-and-forget)
  }),
)

// Watch-time checkpoint. Called by the player at 25% / 50% / 75% / finished
// (relative to the video's actual length, so any duration works).
// hit_8min / hit_15min are the legacy column names — they now store the
// 50% / 75% milestones. Old checkpoint keys are still accepted.
leadsRouter.post(
  '/:phone/progress',
  ah(async (req, res) => {
    const phone = normalizePhone(req.params.phone)
    const percent = clampPercent(req.body?.percent)
    const checkpoint = String(req.body?.checkpoint || '')

    const cols = {
      25: 'hit_25',
      50: 'hit_8min',
      75: 'hit_15min',
      '8min': 'hit_8min',
      '15min': 'hit_15min',
      finished: 'finished',
    }
    const flag = cols[checkpoint]

    await query(
      `UPDATE leads
          SET watch_percent = GREATEST(watch_percent, $2),
              ${flag ? `${flag} = true,` : ''}
              updated_at = now()
        WHERE phone = $1`,
      [phone, percent],
    )
    res.json({ ok: true })
  }),
)

// Canonicalise to a 10-digit Indian mobile. Strips a leading 0 or 91 country
// code, then requires a real mobile: exactly 10 digits starting with 6–9.
// Returns '' for anything invalid (5-digit junk, 9999999999, etc.) so the
// caller rejects it. Storing the bare 10 digits keeps WATI's toWati() (which
// prefixes 91) and payment phone-matching consistent.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  // Strip a leading 0/91 country code ONLY when extra digits are present —
  // never from a bare 10-digit number (e.g. 9176xxxxxx legitimately starts "91").
  const local = digits.length > 10 ? digits.replace(/^(0+|91)/, '') : digits
  if (!/^[6-9]\d{9}$/.test(local)) return '' // wrong length or bad start digit
  if (/^(\d)\1{9}$/.test(local)) return ''    // all-same-digit (9999999999)
  return local
}
function clampPercent(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
