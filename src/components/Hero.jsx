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
        <span className="hero-badge">{hero.badge}</span>

        <h1 className="hero-headline">
          <span className="hl-shine">{hero.headline}</span>{' '}
          <span className="hl">{hero.headlineAccent}</span>
        </h1>

        <p className="hero-subhead">{hero.subhead}</p>

        {/* Form 1 gate + player with watch-time tracking. */}
        <div className="hero-video">
          <VslVideo />
        </div>

        <p className="caption hero-video-caption">{hero.videoCaption}</p>

        {bookingOpen ? (
          <>
            <CTAButton id="cta-primary" where="primary" />
            <p className="caption risk-line">{primaryCta.riskLine}</p>
          </>
        ) : (
          <p className="caption hero-locked-note">
            Keep watching — your booking option opens during the video.
          </p>
        )}
      </div>
    </section>
  )
}
