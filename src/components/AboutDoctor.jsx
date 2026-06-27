import { doctor } from '../content.js'

// SECTION 5 — about the doctor
export default function AboutDoctor() {
  return (
    <section className="wrap" id="about">
      <h2 data-reveal>{doctor.heading}</h2>

      <img
        className="doctor-photo"
        data-reveal="scale"
        src="/award.jpg"
        alt="Doctor Farmer receiving an award with his students"
        loading="lazy"
      />

      {doctor.paragraphs.map((para, i) => (
        <p key={i} data-reveal>{para}</p>
      ))}
    </section>
  )
}
