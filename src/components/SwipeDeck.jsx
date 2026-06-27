import { useState, useRef, useLayoutEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''
const abs = (p) => (p ? `${API_BASE}${p}` : '')

// Sugarfit-style proof cards as a swipeable stacked deck: every card sits in the
// same place, the next ones peek behind, and a swipe (drag) brings the next card
// to the front. Used on the FREE funnel only (see ProofCards.jsx).
export default function SwipeDeck({ cards }) {
  const [index, setIndex] = useState(0)
  const [drag, setDrag] = useState(0) // live horizontal drag of the front card
  const [height, setHeight] = useState(0)
  const startX = useRef(null)
  const dragging = useRef(false)
  const activeRef = useRef(null)
  const n = cards.length

  // Match the deck height to the active card (cards are absolutely stacked).
  useLayoutEffect(() => {
    const measure = () => { if (activeRef.current) setHeight(activeRef.current.offsetHeight) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [index, cards])

  const go = (d) => setIndex((i) => ((i + d) % n + n) % n)

  const onDown = (e) => {
    startX.current = e.clientX
    dragging.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => { if (dragging.current) setDrag(e.clientX - startX.current) }
  const onUp = () => {
    if (!dragging.current) return
    const dx = drag
    dragging.current = false
    setDrag(0)
    if (dx < -55) go(1)
    else if (dx > 55) go(-1)
  }

  return (
    <div className="deck-wrap">
      <div
        className="deck"
        style={{ height: height ? height + 30 : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {cards.map((card, i) => {
          let pos = i - index
          if (pos > n / 2) pos -= n // wrap so the previous card sits just off-left
          if (pos < -n / 2) pos += n
          const active = pos === 0
          let style
          if (pos < 0) {
            style = { transform: 'translateX(-130%) rotate(-7deg)', opacity: 0, pointerEvents: 'none' }
          } else if (active) {
            style = {
              transform: `translateX(${drag}px) rotate(${drag * 0.025}deg)`,
              zIndex: 40,
              transition: dragging.current ? 'none' : undefined,
            }
          } else if (pos <= 2) {
            style = { transform: `translateY(${pos * 16}px) scale(${1 - pos * 0.05})`, zIndex: 40 - pos }
          } else {
            style = { opacity: 0, pointerEvents: 'none' }
          }
          const before = card.stat?.before
          const after = card.stat?.after
          return (
            <article key={card.id ?? i} ref={active ? activeRef : null}
              className={`deck-card ${active ? 'is-active' : ''}`} style={style}>
              <span className="dk-badge">Diabetes Reversal Plan</span>

              <div className="dk-top">
                {card.imageUrl
                  ? <img className="dk-photo" src={abs(card.imageUrl)} alt={card.name || ''} draggable="false" />
                  : <span className="dk-photo dk-photo--ph" aria-hidden="true">🧑</span>}
                <p className="dk-quote">{card.body || card.today || card.stat?.text}</p>
              </div>

              <div className="dk-foot">
                <div className="dk-id">
                  <span className="dk-name">{card.name}</span>
                  <span className="dk-stars" aria-label="5 star rating">★★★★★</span>
                </div>
                {before && after ? (
                  <div className="dk-hba">
                    <span className="dk-hba-label">HbA1c<br /><i>Levels</i></span>
                    <span className="dk-hba-before">{before}</span>
                    <span className="dk-hba-arrow">→</span>
                    <span className="dk-hba-after">{after}</span>
                  </div>
                ) : card.stat?.text ? (
                  <div className="dk-hba"><span className="dk-hba-after">{card.stat.text}</span></div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>

      <div className="dk-dots">
        {cards.map((_, i) => (
          <button key={i} type="button" className={i === index ? 'on' : ''}
            onClick={() => setIndex(i)} aria-label={`Show card ${i + 1}`} />
        ))}
      </div>
    </div>
  )
}
