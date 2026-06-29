// Shared post-payment confirmation UI. Rendered in-place inside the booking
// modal (so all pixel events fire on one page, no redirect) and also by the
// /payment-success route for direct hits.
export default function ThankYou({ name, mobile, onHome }) {
  return (
    <div className="ty">
      <div className="ty-check" aria-hidden="true">✓</div>
      <h1 className="ty-title">Congratulations — your payment is confirmed!</h1>
      <p className="ty-sub">
        Thank you for booking your 1:1 Diabetes Recovery Assessment Call. Your payment
        receipt has been sent to your email and WhatsApp.
      </p>
      <div className="ty-next">
        <p className="ty-next-label">WHAT HAPPENS NEXT</p>
        <p className="ty-next-head">
          Our team will call you back shortly to schedule your one-to-one specialist
          consultation.
        </p>
        <p className="ty-next-body">
          Please keep your phone handy — most callbacks happen within the next few working
          hours. We’re looking forward to partnering with you on your journey to reverse
          diabetes and reclaim your health.
        </p>
      </div>

      <div className="ty-card">
        <p className="ty-card-label">YOUR DETAILS</p>
        <div className="ty-row"><span>Name</span><strong>{name || '—'}</strong></div>
        <div className="ty-row"><span>Mobile</span><strong>{mobile ? `+91${mobile}` : '—'}</strong></div>
      </div>

      <div className="ty-card ty-card--support">
        <p className="ty-card-label">OUR SUPPORT CONTACT</p>
        <p className="ty-support-intro">In case you want to reach out to us, here are our support details:</p>
        <div className="ty-row"><span>Email</span><strong>support@myhealthschool.in</strong></div>
        <div className="ty-row"><span>Mobile</span><strong>+91-9952711053</strong></div>
      </div>

      {onHome
        ? <button type="button" className="cta ty-home" onClick={onHome}>Back to home</button>
        : <a className="cta ty-home" href="/">Back to home</a>}
    </div>
  )
}
