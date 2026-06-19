import 'dotenv/config'

// Resolve the Google service-account email + private key from either the full
// downloaded JSON (GOOGLE_SERVICE_ACCOUNT_JSON) or the split EMAIL/KEY vars.
function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''
  if (raw.trim()) {
    try {
      const j = JSON.parse(raw)
      // JSON.parse already converts the "\n" escapes into real newlines.
      return { serviceAccountEmail: j.client_email || '', serviceAccountKey: j.private_key || '' }
    } catch {
      // eslint-disable-next-line no-console
      console.error('[config] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — ignoring it')
    }
  }
  return {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    serviceAccountKey: (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
  }
}

// Central config — all env reads happen here so the rest of the code is clean.
export const config = {
  port: Number(process.env.PORT) || 8787,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),

  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',

  holdWindowMinutes: Number(process.env.HOLD_WINDOW_MINUTES) || 15,

  razorpay: {
    mode: process.env.RAZORPAY_MODE || 'mock', // 'mock' | 'live'
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    pricePaise: Number(process.env.PRICE_PAISE) || 5000,
    // Optional Razorpay-hosted payment page (rzp.io/...). When set, the booking
    // flow sends payers here instead of opening the Checkout popup — useful
    // while the site domain is still under Razorpay review.
    paymentLink: process.env.RAZORPAY_PAYMENT_LINK || '',
  },

  whapi: {
    token: process.env.WHAPI_TOKEN || '',
    baseUrl: process.env.WHAPI_BASE_URL || 'https://gate.whapi.cloud',
  },

  // WATI WhatsApp template API (utility templates).
  wati: {
    token: process.env.WATI_TOKEN || '',
    baseUrl: process.env.WATI_BASE_URL || '',
    webhookToken: process.env.WATI_WEBHOOK_TOKEN || '',
    templates: {
      // booking confirmation, sent on payment success (date + time vars)
      paymentSuccess: process.env.WATI_TPL_PAYMENT_SUCCESS || 'appoinment_immediate',
      // reminder sent 1 hour before the booked slot (date + time vars)
      oneHour: process.env.WATI_TPL_ONE_HOUR || 'one_hour_togo',
      // internal alert when a lead finishes the video (name + phone vars)
      leadAlert: process.env.WATI_TPL_LEAD_ALERT || 'lead_alert',
    },
    // internal number that receives the lead_alert template (no customer ever gets it)
    leadAlertPhone: process.env.LEAD_ALERT_PHONE || '9952711053',
  },

  // Google service account (Sheets export). Server-to-server JWT auth — no
  // per-request login, no expiring refresh token. Share the target sheet with
  // the service account's email (Editor) so it can write to it.
  // Prefer the full downloaded JSON in GOOGLE_SERVICE_ACCOUNT_JSON; fall back to
  // the split EMAIL/KEY vars. JSON.parse turns the key's "\n" into real newlines.
  google: parseServiceAccount(),

  adminToken: process.env.ADMIN_TOKEN || 'change-me-admin-token',
}
