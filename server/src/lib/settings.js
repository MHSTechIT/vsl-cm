import { query } from '../db.js'

// Settings are per-funnel: the same key holds a different value for 'paid' vs
// 'free'. Callers that don't care pass no funnel and operate on 'paid'.

export async function setSetting(key, value, funnel = 'paid') {
  await query(
    `INSERT INTO settings (key, funnel, value) VALUES ($1, $3, $2)
     ON CONFLICT (key, funnel) DO UPDATE SET value = EXCLUDED.value`,
    [key, value == null ? null : String(value), funnel],
  )
}

export async function getSettings(keys, funnel = 'paid') {
  const { rows } = await query(
    `SELECT key, value FROM settings WHERE key = ANY($1) AND funnel = $2`,
    [keys, funnel],
  )
  const out = {}
  for (const r of rows) out[r.key] = r.value
  return out
}
