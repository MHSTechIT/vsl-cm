import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { leadsRouter } from './routes/leads.js'
import { slotsRouter } from './routes/slots.js'
import { paymentRouter, razorpayWebhook } from './routes/payment.js'
import { adminRouter, staffLogin } from './routes/admin.js'
import { watiWebhook } from './routes/watiWebhook.js'
import { startHoldSweeper } from './lib/holds.js'
import { ah } from './lib/ah.js'
import { getSettings } from './lib/settings.js'
import { query } from './db.js'

const app = express()
app.use(cors({ origin: config.corsOrigin }))

// Razorpay webhook needs the RAW body for signature verification, so it must
// be registered BEFORE the JSON parser.
app.post('/api/payment/webhook', express.raw({ type: '*/*' }), razorpayWebhook)

app.use(express.json())

// WATI inbound-message webhook (JSON body)
app.post('/api/wati/webhook', watiWebhook)

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// Serve media (video/thumbnail/report images) straight from the DB, with HTTP
// Range support so <video> can stream + seek.
app.get(
  '/media/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id)
    const meta = await query(`SELECT mimetype, octet_length(data) AS size FROM media WHERE id = $1`, [id])
    if (!meta.rows.length) return res.status(404).end()
    const mimetype = meta.rows[0].mimetype
    const size = Number(meta.rows[0].size)
    const range = req.headers.range

    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)
      const start = m ? parseInt(m[1], 10) : 0
      const end = m && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
      const len = end - start + 1
      const chunk = await query(`SELECT substring(data from $2 for $3) AS d FROM media WHERE id = $1`, [id, start + 1, len])
      res.writeHead(206, {
        'Content-Type': mimetype,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': len,
        'Cache-Control': 'public, max-age=3600',
      })
      return res.end(chunk.rows[0].d)
    }

    const full = await query(`SELECT data FROM media WHERE id = $1`, [id])
    res.writeHead(200, {
      'Content-Type': mimetype,
      'Accept-Ranges': 'bytes',
      'Content-Length': size,
      'Cache-Control': 'public, max-age=3600',
    })
    res.end(full.rows[0].data)
  }),
)

// public landing-page config (video, poster, booking-reveal time)
app.get(
  '/api/config',
  ah(async (_req, res) => {
    const s = await getSettings(['video_id', 'thumb_id', 'reveal_seconds', 'vimeo_id'])
    res.json({
      vimeoId: s.vimeo_id || null,
      videoUrl: s.video_id ? `/media/${s.video_id}` : null,
      thumbUrl: s.thumb_id ? `/media/${s.thumb_id}` : null,
      revealSeconds: s.reveal_seconds != null ? Number(s.reveal_seconds) : 900,
      paymentLink: config.razorpay.paymentLink || null,
    })
  }),
)

// public testimonials (proof cards) for the landing page
app.get(
  '/api/testimonials',
  ah(async (_req, res) => {
    const { rows } = await query(`SELECT * FROM testimonials ORDER BY sort_order, id`)
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        body: r.body,
        statBefore: r.stat_before,
        statAfter: r.stat_after,
        statText: r.stat_text,
        today: r.today,
        imageUrl: r.image_id ? `/media/${r.image_id}` : r.image_file ? `/uploads/${r.image_file}` : null,
      })),
    )
  }),
)

// staff login is public — must be registered before the admin auth router
app.post('/api/admin/login', ah(staffLogin))

app.use('/api/leads', leadsRouter)
app.use('/api/slots', slotsRouter)
app.use('/api/payment', paymentRouter)
app.use('/api/admin', adminRouter)

// Last-resort error handler so a thrown route never crashes the process.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error('[api] error:', err.message)
  res.status(500).json({ error: 'server error' })
})

process.on('unhandledRejection', (e) =>
  // eslint-disable-next-line no-console
  console.error('[api] unhandledRejection:', e?.message || e),
)

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`✓ API on http://localhost:${config.port}  (razorpay: ${config.razorpay.mode})`)
  startHoldSweeper()
  // 1-hour reminder disabled — only the payment-success template is sent.
})
