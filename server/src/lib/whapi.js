import { config } from '../config.js'
import { query } from '../db.js'

const { token, baseUrl } = config.whapi

// Send a WhatsApp text via Whapi.cloud. If no token is configured, we DON'T
// fail the flow — we flag the lead (`needs_wa`) so the team can see/send it
// from the admin panel.
export async function sendWhatsApp(phone, message, kind /* 'rescue' | 'confirmation' */) {
  if (!token) {
    await query(`UPDATE leads SET needs_wa = $2, updated_at = now() WHERE phone = $1`, [
      phone,
      kind,
    ])
    return { sent: false, flagged: true }
  }

  try {
    const res = await fetch(`${baseUrl}/messages/text`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // Whapi expects the number in international format (no '+'), e.g. 9198...
      body: JSON.stringify({ to: phone.replace(/\D/g, ''), body: message }),
    })
    const ok = res.ok
    await query(
      `UPDATE leads SET needs_wa = $2, wa_sent_at = CASE WHEN $3 THEN now() ELSE wa_sent_at END, updated_at = now() WHERE phone = $1`,
      [phone, ok ? null : kind, ok],
    )
    return { sent: ok }
  } catch (err) {
    await query(`UPDATE leads SET needs_wa = $2, updated_at = now() WHERE phone = $1`, [
      phone,
      kind,
    ])
    return { sent: false, error: err.message }
  }
}

export const rescueMessage = () =>
  'Your slot is still held for a few more minutes. Complete your ₹50 booking here to confirm it.'

export const confirmationMessage = (date, time) =>
  `✅ Your health assessment is booked for ${date} at ${time}. Our team will call you. — My Health School`
