// The registered lead's identity persists in localStorage so a returning
// visitor stays "enrolled" and the booking form can prefill. Namespaced per
// funnel so a paid-funnel lead and a free-funnel lead don't clash in one
// browser ('paid' keeps the original key for back-compat).
import { getFunnel } from './funnel.js'

const KEY = getFunnel() === 'free' ? 'vsl_lead_free' : 'vsl_lead'

export function saveLead(lead) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lead))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('lead-changed'))
}

export function getLead() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

export const isRegistered = () => Boolean(getLead()?.phone)
