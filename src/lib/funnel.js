// Which funnel this page belongs to. The 'free' funnel is served on its own
// domain in production (set VITE_FREE_HOSTS to a comma-separated host list);
// for local testing it's also reachable at the /free or /masterclass path.
// Determined once at load and reused everywhere (api calls, session, booking).
const FREE_HOSTS = (import.meta.env.VITE_FREE_HOSTS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

let cached = null
export function getFunnel() {
  if (cached) return cached
  try {
    const host = window.location.hostname.toLowerCase()
    const path = window.location.pathname.toLowerCase()
    const pathFree =
      path === '/free' || path.startsWith('/free/') ||
      path === '/masterclass' || path.startsWith('/masterclass/')
    cached = FREE_HOSTS.includes(host) || pathFree ? 'free' : 'paid'
  } catch {
    cached = 'paid'
  }
  return cached
}

export const isFreeFunnel = () => getFunnel() === 'free'
