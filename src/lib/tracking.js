// ============================================================
// PHASE 3 PLACEHOLDER — analytics / pixel events
// ------------------------------------------------------------
// These are no-op stubs for now. In Phase 3 they will fire the
// Meta Pixel (client) and Conversions API (server) events.
// Components call track(...) so the call sites are already in
// place and wiring real events later is a one-file change.
// ============================================================

export function track(eventName, payload = {}) {
  // PHASE 3: replace with window.fbq('track', eventName, payload)
  // and/or a fetch() to the Conversions API endpoint.
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[track:stub]', eventName, payload)
  }
}

// Convenience wrappers for the events we already know we'll need.
export const trackViewContent = () => track('ViewContent')
export const trackBookingClick = (where) =>
  track('InitiateCheckout', { cta_location: where })
