import { useEffect, useState } from 'react'
import { hero, primaryCta } from '../content.js'
import VslVideo from './VslVideo.jsx'
import CTAButton from './CTAButton.jsx'

// SECTION 1 — centered VSL hero (badge, headline, video, CTA).
// The booking CTA stays hidden until the player fires 'booking-unlock'
// (at the reveal time set in the admin panel).
export default function Hero() {
  const [bookingOpen, setBookingOpen] = useState(false)

  useEffect(() => {
    const onUnlock = () => setBookingOpen(true)
    window.addEventListener('booking-unlock', onUnlock)
    return () => window.removeEventListener('booking-unlock', onUnlock)
  }, [])

  return (
    <section className="hero-vsl" id="hero">
      <div className="hero-vsl-inner">
        <span className="hero-badge" data-reveal>{hero.badge}</span>

        <h1 className="hero-headline" data-reveal>
          <span className="hl-shine">{hero.headline}</span>{' '}
          <span className="hl">{hero.headlineAccent}</span>
        </h1>

        <p className="hero-subhead" data-reveal>{hero.subhead}</p>

        {/* Form 1 gate + player with watch-time tracking. */}
        <div className="hero-video" data-reveal="scale">
          <VslVideo />
        </div>

        <p className="caption hero-video-caption" data-reveal>{hero.videoCaption}</p>

        {bookingOpen && (
          <>
            <CTAButton id="cta-primary" where="primary" />
            <p className="caption risk-line">{primaryCta.riskLine}</p>
          </>
        )}
      </div>
    </section>
  )
}
