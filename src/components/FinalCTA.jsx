import { useEffect, useState } from 'react'
import { finalCta } from '../content.js'
import CTAButton from './CTAButton.jsx'

// SECTION 7 — final CTA.
// Gated by the same 'booking-unlock' event as the hero CTA, so it only
// appears once the viewer reaches the reveal time set in the admin panel.
export default function FinalCTA() {
  const [bookingOpen, setBookingOpen] = useState(false)

  useEffect(() => {
    const onUnlock = () => setBookingOpen(true)
    window.addEventListener('booking-unlock', onUnlock)
    return () => window.removeEventListener('booking-unlock', onUnlock)
  }, [])

  return (
    <section className="wrap final-cta" id="final">
      <h2 data-reveal>{finalCta.heading}</h2>
      {bookingOpen && (
        <>
          <CTAButton id="cta-final" where="final" />
          <p className="caption risk-line">{finalCta.riskLine}</p>
        </>
      )}
    </section>
  )
}
