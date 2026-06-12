import 'dotenv/config'

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

  // WATI WhatsApp template API (utility templates: payment_success / payment_failed_ / one_hour)
  wati: {
    token: process.env.WATI_TOKEN || '',
    baseUrl: process.env.WATI_BASE_URL || '',
    webhookToken: process.env.WATI_WEBHOOK_TOKEN || '',
    templates: {
      // 'vsl' — the approved booking-confirmation template (date + time vars)
      paymentSuccess: process.env.WATI_TPL_PAYMENT_SUCCESS || 'vsl',
    },
  },

  // Google OAuth (Sheets export). Refresh-token flow — no per-request login.
  google: {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
  },

  adminToken: process.env.ADMIN_TOKEN || 'change-me-admin-token',
}
