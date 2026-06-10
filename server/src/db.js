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
})

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] unexpected pool error:', err.message)
})

export const query = (text, params) => pool.query(text, params)
