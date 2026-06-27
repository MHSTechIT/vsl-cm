// Scroll-reveal for the FREE funnel — mirrors the "appear" motion of the
// reference (a Framer site): each marked block starts faded + offset and
// animates in (fade + slide-up, or scale-in) as it enters the viewport.
// Elements opt in with a `data-reveal` attribute; the hidden start-state and
// the transition live in styles.css, scoped to body.is-free-funnel. This only
// runs in the free funnel (see App.jsx), so the paid funnel is never affected.

const SEL = 'body.is-free-funnel [data-reveal]'

export function initScrollReveal() {
  const targets = () => [...document.querySelectorAll(SEL)]
  const show = (el) => el.classList.add('is-in')

  // No-motion / unsupported → just show everything (no hidden state remains).
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || typeof IntersectionObserver === 'undefined') {
    targets().forEach(show)
    return null
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          stagger(e.target)
          show(e.target)
          io.unobserve(e.target)
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  )

  // Track observed nodes in a per-instance Set (NOT a dom attribute) so a fresh
  // init — e.g. React StrictMode's mount→cleanup→mount in dev — re-observes all.
  const watched = new WeakSet()
  const observe = (el) => {
    if (watched.has(el)) return
    watched.add(el)
    io.observe(el)
  }
  targets().forEach(observe)

  // Proof cards load from the API after mount — pick up late-added targets.
  const mo = new MutationObserver(() => targets().forEach(observe))
  mo.observe(document.body, { childList: true, subtree: true })

  // Safety net: reveal anything still hidden in the viewport after a moment
  // (guards against a missed observer callback leaving content invisible).
  const t = setTimeout(() => {
    for (const el of targets()) {
      if (!el.classList.contains('is-in') && el.getBoundingClientRect().top < window.innerHeight) show(el)
    }
  }, 3500)

  return { destroy: () => { io.disconnect(); mo.disconnect(); clearTimeout(t) } }
}

// Stagger reveal-siblings under the same parent (e.g. the stack of proof cards).
function stagger(el) {
  const parent = el.parentElement
  if (!parent) return
  const sibs = [...parent.querySelectorAll(':scope > [data-reveal]')]
  const i = sibs.indexOf(el)
  if (i > 0) el.style.transitionDelay = `${Math.min(i, 6) * 70}ms`
}
