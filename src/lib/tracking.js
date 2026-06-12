// ============================================================
// Meta Pixel event helpers
// ------------------------------------------------------------
// The base pixel + auto PageView live in index.html. These helpers
// fire the funnel's custom events. Every call is guarded so a blocked
// or not-yet-loaded pixel never throws, and each logs to the console
// (always — not just in DEV) so events can be confirmed during testing.
// ============================================================

function fbqSafe(...args) {
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    window.fbq(...args)
  }
}

// ---- Funnel events ----
export const trackRegistered = () => {
  fbqSafe('trackCustom', 'Registered')
  // eslint-disable-next-line no-console
  console.log('PIXEL: Registered fired')
}
export const trackVideo15Min = () => {
  fbqSafe('trackCustom', 'Video15Min')
  // eslint-disable-next-line no-console
  console.log('PIXEL: Video15Min fired')
}
export const trackAppointmentInterested = () => {
  fbqSafe('trackCustom', 'AppointmentInterested')
  // eslint-disable-next-line no-console
  console.log('PIXEL: AppointmentInterested fired')
}
export const trackAppointmentBooked = () => {
  fbqSafe('trackCustom', 'AppointmentBooked')
  // eslint-disable-next-line no-console
  console.log('PIXEL: AppointmentBooked fired')
}
// Standard Purchase — fired when the payment-success card appears.
export const trackPurchase = (value = 50, currency = 'INR') => {
  fbqSafe('track', 'Purchase', { value, currency })
  // eslint-disable-next-line no-console
  console.log('PIXEL: Purchase fired')
}

// ---- Back-compat shims (kept so existing imports don't break) ----
export function track(eventName, payload = {}) {
  fbqSafe('track', eventName, payload)
}
export const trackViewContent = () => track('ViewContent')
export const trackBookingClick = (where) => track('InitiateCheckout', { cta_location: where })
