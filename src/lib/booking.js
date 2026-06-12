// ============================================================
// ₹99 booking action — opens the Form 2 booking modal.
// ------------------------------------------------------------
// Both CTA buttons call openBooking(). It fires the tracking event
// and dispatches 'open-booking', which BookingModalHost listens for.
// ============================================================

import { trackAppointmentInterested } from './tracking.js'

export function openBooking(where = 'unknown') {
  trackAppointmentInterested() // booking intent — fires on the click, before payment
  window.dispatchEvent(new CustomEvent('open-booking', { detail: { where } }))
}
