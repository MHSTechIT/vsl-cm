// The two funnels. 'paid' = original ₹ VSL; 'free' = no-payment masterclass copy.
export const FUNNELS = ['paid', 'free']

// Normalise an untrusted funnel value to a known funnel (defaults to 'paid').
export function parseFunnel(v) {
  const f = String(v || '').toLowerCase()
  return FUNNELS.includes(f) ? f : 'paid'
}
