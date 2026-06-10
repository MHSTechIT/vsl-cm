import { query } from '../db.js'

export async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value == null ? null : String(value)],
  )
}

export async function getSettings(keys) {
  const { rows } = await query(`SELECT key, value FROM settings WHERE key = ANY($1)`, [keys])
  const out = {}
  for (const r of rows) out[r.key] = r.value
  return out
}
