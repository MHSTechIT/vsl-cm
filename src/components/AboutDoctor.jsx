import { doctor } from '../content.js'
import { ImagePlaceholder } from './Placeholder.jsx'

// SECTION 5 — about the doctor
export default function AboutDoctor() {
  return (
    <section className="wrap" id="about">
      <h2>{doctor.heading}</h2>

      {/* PHASE 2/3: real group photo goes here */}
      <ImagePlaceholder
        label="[Group photo — Doctor Farmer with students / award]"
        className="doctor-photo"
      />

      {doctor.paragraphs.map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </section>
  )
}
