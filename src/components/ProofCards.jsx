import { useEffect, useState } from 'react'
import { proof } from '../content.js'
import { ImagePlaceholder } from './Placeholder.jsx'
import { api } from '../lib/api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''
const abs = (p) => (p ? `${API_BASE}${p}` : '')

function Stat({ stat }) {
  if (stat?.text) return <span className="stat">{stat.text}</span>
  if (stat?.before && stat?.after) {
    return (
      <span className="stat">
        HbA1c: {stat.before} <span className="arrow">&rarr;</span> {stat.after}
      </span>
    )
  }
  return null
}

function Card({ card, num }) {
  return (
    <article className="card">
      <span className="card-pin" aria-hidden="true" />
      <span className="card-num">{String(num).padStart(2, '0')}</span>

      <p className="card-name">{card.name}</p>

      {card.imageUrl ? (
        <img className="card-img" src={abs(card.imageUrl)} alt="Blood report — before/after" loading="lazy" />
      ) : (
        <ImagePlaceholder label="[Blood report — before/after]" className="img-placeholder" />
      )}

      {card.body && <p>{card.body}</p>}
      <Stat stat={card.stat} />
      {card.today && <p>{card.today}</p>}
    </article>
  )
}

// Default (placeholder) cards from content.js — used until admin adds real ones.
const normalizeLocal = (c) => ({
  id: c.id, name: c.name, body: c.body, today: c.today, stat: c.stat, imageUrl: null,
})
// Admin-managed cards from the API.
const normalizeApi = (t) => ({
  id: t.id, name: t.name, body: t.body, today: t.today,
  stat: { before: t.statBefore, after: t.statAfter, text: t.statText },
  imageUrl: t.imageUrl,
})

// SECTION 3 — proof cards, listed one after another down the page.
export default function ProofCards() {
  const [cards, setCards] = useState(proof.cards.map(normalizeLocal))

  useEffect(() => {
    api.testimonials()
      .then((rows) => { if (rows && rows.length) setCards(rows.map(normalizeApi)) })
      .catch(() => {})
  }, [])

  return (
    <section className="wrap" id="proof">
      <h2 className="center">{proof.heading}</h2>

      <div className="cards-stack">
        {cards.map((card, i) => (
          <Card key={card.id ?? i} card={card} num={i + 1} />
        ))}
      </div>

      <p className="cards-footer">{proof.footer}</p>
    </section>
  )
}
