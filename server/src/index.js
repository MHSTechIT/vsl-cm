import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { leadsRouter } from './routes/leads.js'
import { slotsRouter } from './routes/slots.js'
import { paymentRouter, razorpayWebhook } from './routes/payment.js'
import { adminRouter, uploadsDir } from './routes/admin.js'
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

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// serve uploaded video/thumbnail files
app.use('/uploads', express.static(uploadsDir))

// public landing-page config (video, poster, booking-reveal time)
app.get(
  '/api/config',
  ah(async (_req, res) => {
    const s = await getSettings(['video_file', 'thumb_file', 'reveal_seconds'])
    res.json({
      videoUrl: s.video_file ? `/uploads/${s.video_file}` : null,
      thumbUrl: s.thumb_file ? `/uploads/${s.thumb_file}` : null,
      revealSeconds: s.reveal_seconds != null ? Number(s.reveal_seconds) : 900,
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
        imageUrl: r.image_file ? `/uploads/${r.image_file}` : null,
      })),
    )
  }),
)

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
})
