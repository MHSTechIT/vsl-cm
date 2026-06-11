import { query } from '../db.js'
import { config } from '../config.js'

// WATI posts here on every message event (configure the URL in WATI →
// Settings → Webhooks). We store inbound (and WATI-sent outbound) messages so
// the admin inbox can show the conversation. Optional shared-secret via
// ?token= matching WATI_WEBHOOK_TOKEN.
export async function watiWebhook(req, res) {
  try {
    const expected = config.wati.webhookToken
    if (expected && String(req.query.token || '') !== expected) {
      return res.status(401).json({ error: 'bad token' })
    }
    const b = req.body || {}
    // WATI field names vary slightly by event — accept the common ones.
    const waId = String(b.waId || b.whatsappNumber || b.phone || '').replace(/\D/g, '')
    const text = b.text || b.messageBody || b.data || ''
    const type = b.type || 'text'
    const name = b.senderName || b.name || null
    const watiId = b.id || b.whatsappMessageId || b.messageId || null
    // owner=true means the business sent it; false/absent = from the customer.
    const direction = b.owner === true ? 'out' : 'in'

    // ignore status-only pings (delivered/read) with no message body
    if (waId && (text || type !== 'text')) {
      await query(
        `INSERT INTO wa_messages (wa_id, name, direction, text, type, wati_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (wati_id) WHERE wati_id IS NOT NULL DO NOTHING`,
        [waId, name, direction, String(text), type, watiId],
      )
    }
    res.json({ ok: true })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[wati-webhook] error:', e.message)
    res.status(200).json({ ok: false }) // 200 so WATI doesn't hammer retries
  }
}
