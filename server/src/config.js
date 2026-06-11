import 'dotenv/config'

// Central config — all env reads happen here so the rest of the code is clean.
export const config = {
  port: Number(process.env.PORT) || 8787,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),

  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',

  holdWindowMinutes: Number(process.env.HOLD_WINDOW_MINUTES) || 12,

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

  adminToken: process.env.ADMIN_TOKEN || 'change-me-admin-token',
}
