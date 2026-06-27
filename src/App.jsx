import { useEffect } from 'react'
import Hero from './components/Hero.jsx'
import BookingModalHost from './components/BookingModalHost.jsx'
import ProofCards from './components/ProofCards.jsx'
import AboutDoctor from './components/AboutDoctor.jsx'
import FAQ from './components/FAQ.jsx'
import FinalCTA from './components/FinalCTA.jsx'
import { isFreeFunnel } from './lib/funnel.js'
import { initScrollReveal } from './lib/scrollReveal.js'

// Thin divider between major sections.
const Divider = () => <hr className="divider" />

/**
 * Single-page VSL landing page.
 *
 * CRITICAL LAYOUT RULE: no nav, no menu, no header/footer links.
 * The only interactive elements are the two CTA buttons and the FAQ
 * accordion. Do not add anything that lets the click escape the page.
 *
 * Sections render top-to-bottom in the exact required order.
 */
export default function App() {
  // Free funnel: animate landing blocks in as they scroll into view.
  useEffect(() => {
    if (!isFreeFunnel()) return undefined
    let h
    try {
      h = initScrollReveal()
    } catch {
      // never leave content hidden if the reveal setup fails
      document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'))
    }
    return () => h?.destroy?.()
  }, [])

  return (
    <main>
      <Hero />
      <Divider />
      <ProofCards />
      <Divider />
      <AboutDoctor />
      <Divider />
      <FAQ />
      <Divider />
      <FinalCTA />

      {/* Form 2 booking modal — opened by the CTA buttons */}
      <BookingModalHost />
    </main>
  )
}
