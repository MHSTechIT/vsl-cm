import { ctaLabel } from '../content.js'
import { openBooking } from '../lib/booking.js'

/**
 * Primary call-to-action button (used in Section 2 and Section 7).
 *
 * @param {string} id    - DOM id ("cta-primary" | "cta-final"); kept stable
 *                         because Phase 3 wiring + pixel events target these.
 * @param {string} where - label passed to the booking/track stubs so we can
 *                         tell which button was clicked.
 */
export default function CTAButton({ id, where }) {
  // PHASE 3: openBooking() is currently a stub — it will launch the
  // ₹99 booking form / payment flow and fire conversion events.
  return (
    <button
      type="button"
      id={id}
      className="cta"
      onClick={() => openBooking(where)}
    >
      {ctaLabel}
    </button>
  )
}
