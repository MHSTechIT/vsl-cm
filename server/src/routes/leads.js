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

    await query(
      `INSERT INTO leads (phone, name)
       VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [phone, name],
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

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  return digits.length >= 8 ? digits : ''
}
function clampPercent(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
