import { faq } from '../content.js'

// SECTION 6 — FAQ. Native <details>/<summary> accordion (no JS state needed).
export default function FAQ() {
  return (
    <section className="wrap" id="faq">
      <h2 data-reveal>{faq.heading}</h2>

      <div className="faq">
        {faq.items.map((item, i) => (
          <details key={i} data-reveal>
            <summary>{item.q}</summary>
            <div className="answer">{item.a}</div>
          </details>
        ))}
      </div>
    </section>
  )
}
