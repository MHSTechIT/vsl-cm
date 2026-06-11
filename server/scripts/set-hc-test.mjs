// Temporary: set HC test states to verify the status tags, then run with "clear" to undo.
import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

const mode = process.argv[2] || 'set'
if (mode === 'set') {
  const full = {
    sugar_level: '250+', age: '47', gender: 'Male', l1_detox: 'Joined',
    professional: 'Engineer', location: 'Chennai', other_issues: 'BP',
  }
  const partial = {
    sugar_level: '150', age: '', gender: '', l1_detox: '',
    professional: '', location: '', other_issues: '',
  }
  await pool.query(`UPDATE leads SET hc_data=$1::jsonb WHERE phone='8754689554'`, [JSON.stringify(full)])
  await pool.query(`UPDATE leads SET hc_data=$1::jsonb WHERE phone='9999999999'`, [JSON.stringify(partial)])
  console.log('test states set (full → 8754689554, partial → 9999999999)')
} else {
  await pool.query(`UPDATE leads SET hc_data=NULL, hc_status=NULL WHERE phone IN ('8754689554','9999999999')`)
  console.log('test states cleared')
}
await pool.end()
