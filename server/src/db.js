import pg from 'pg'
import { config } from './config.js'

// Keep DATE columns (OID 1082) as raw 'YYYY-MM-DD' strings instead of letting
// pg build a local-midnight Date — that avoids a timezone day-shift when the
// value is serialized back to the client.
pg.types.setTypeParser(1082, (v) => v)

// Single shared connection pool. The browser never touches this — only the API.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  // Resilience for a remote DB behind cloud NAT/firewalls: keep idle TCP
  // connections warm so they aren't silently severed mid-idle — the usual cause
  // of the intermittent ECONNRESET / EHOSTUNREACH we were seeing. Plus bounded
  // waits so a slow/unreachable host fails fast instead of hanging a request.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  max: Number(process.env.PGPOOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (err) => {
  // An idle client dropped its connection. The pool discards it and makes a new
  // one on the next query — log, never crash.
  // eslint-disable-next-line no-console
  console.error('[db] idle client error (recovered):', err.message)
})

// Connection-ESTABLISHMENT failures only — these mean the query never reached
// the server, so retrying is safe (no risk of double-applying a write). We do
// NOT retry mid-statement resets, to keep payments/bookings exactly-once.
const RETRYABLE = /EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|timeout exceeded when trying to connect/i

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Shared query helper with a short retry for transient connection blips, so a
// single dropped link doesn't surface as a failed request (or a half-written
// sheet sync). Up to 3 attempts with linear backoff (~0.25s, 0.5s).
export async function query(text, params) {
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await pool.query(text, params)
    } catch (e) {
      lastErr = e
      if (attempt === 3 || !RETRYABLE.test(e.message || '')) throw e
      const backoff = 250 * attempt
      // eslint-disable-next-line no-console
      console.error(`[db] transient connect error — retry ${attempt}/2 in ${backoff}ms:`, e.message)
      await sleep(backoff)
    }
  }
  throw lastErr
}
