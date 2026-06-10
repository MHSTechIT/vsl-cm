import { qualify } from '../content.js'
import { CheckIcon, CrossIcon } from './icons.jsx'

// SECTION 4 — who this is for
export default function Qualify() {
  return (
    <section className="wrap" id="qualify">
      {/* Block A — for you (the eye should land here first) */}
      <div className="qualify-block">
        <h3>{qualify.forHeading}</h3>
        <ul className="qualify-list">
          {qualify.forPoints.map((point, i) => (
            <li key={i}>
              <CheckIcon />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Block B — not for you (intentionally quieter / muted grey) */}
      <div className="qualify-block qualify-block--no">
        <h3>{qualify.notHeading}</h3>
        <ul className="qualify-list">
          {qualify.notPoints.map((point, i) => (
            <li key={i}>
              <CrossIcon />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="qualify-footer">{qualify.footer}</p>
    </section>
  )
}
