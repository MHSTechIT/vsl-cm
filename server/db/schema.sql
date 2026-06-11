-- ============================================================
-- Phase 2 schema — leads + slots
-- Run with:  npm run db:setup   (or paste into pgAdmin)
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  phone            TEXT PRIMARY KEY,          -- unique identifier for the whole journey
  name             TEXT NOT NULL,
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- watch-time tracking
  watch_percent    INTEGER NOT NULL DEFAULT 0,
  hit_25           BOOLEAN NOT NULL DEFAULT false,
  hit_8min         BOOLEAN NOT NULL DEFAULT false,
  hit_15min        BOOLEAN NOT NULL DEFAULT false,
  finished         BOOLEAN NOT NULL DEFAULT false,

  -- booking
  form2_submitted  BOOLEAN NOT NULL DEFAULT false,
  slot_date        DATE,
  slot_time        TEXT,
  slot_status      TEXT,                      -- pending | confirmed (null = none)

  -- payment
  paid             BOOLEAN NOT NULL DEFAULT false,
  paid_at          TIMESTAMPTZ,
  rzp_order_id     TEXT,                      -- last Razorpay order, for server-side reconciliation
  rzp_payment_id   TEXT,                      -- captured payment id (used to match refunds back)
  refunded_at      TIMESTAMPTZ,               -- set when a refund webhook arrives

  -- WhatsApp automation queue (used when Whapi token is absent / for review)
  needs_wa         TEXT,                      -- 'rescue' | 'confirmation' | null
  wa_sent_at       TIMESTAMPTZ,

  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per bookable seat (date + time). "10-20 slots/day" = number of times.
CREATE TABLE IF NOT EXISTS slots (
  id               SERIAL PRIMARY KEY,
  slot_date        DATE NOT NULL,
  slot_time        TEXT NOT NULL,             -- e.g. "18:00"
  status           TEXT NOT NULL DEFAULT 'available', -- available | pending | confirmed | blocked
  held_by_phone    TEXT,
  hold_expires_at  TIMESTAMPTZ,
  lead_phone       TEXT,                      -- owner once confirmed
  release_wave     INTEGER,                   -- blocked seats: 1 = opens after 5 payments, 2 = after 10
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_date, slot_time)
);

-- Key/value config (current video, thumbnail, booking-reveal time, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Binary media (video, thumbnail, report images) stored IN the database
CREATE TABLE IF NOT EXISTS media (
  id         SERIAL PRIMARY KEY,
  kind       TEXT,
  mimetype   TEXT NOT NULL DEFAULT 'application/octet-stream',
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proof / testimonial cards shown on the landing page (managed from admin)
CREATE TABLE IF NOT EXISTS testimonials (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,            -- "Rajan, 47 — software professional, Chennai"
  body        TEXT,                     -- the description line
  stat_before TEXT,                     -- e.g. "9.2"
  stat_after  TEXT,                     -- e.g. "5.8"
  stat_text   TEXT,                     -- fallback single-line stat (overrides before/after)
  today       TEXT,                     -- the "Today: ..." line
  image_file  TEXT,                     -- (legacy) filesystem image name
  image_id    INTEGER,                  -- media row holding the report image
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS image_id INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rzp_order_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rzp_payment_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS release_wave INTEGER;

-- Idempotency log — Razorpay retries webhooks; the unique (source,event_id)
-- gate stops the same event from being processed twice.
CREATE TABLE IF NOT EXISTS webhook_events (
  id           SERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, event_id)
);

-- Never lose a payment: a captured payment we can't match to a lead lands
-- here for manual reconcile instead of vanishing.
CREATE TABLE IF NOT EXISTS unmatched_payments (
  id              SERIAL PRIMARY KEY,
  payment_id      TEXT NOT NULL UNIQUE,
  order_id        TEXT,
  amount          NUMERIC NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'INR',
  payer_email     TEXT,
  payer_phone     TEXT,
  notes           JSONB,
  raw_payload     JSONB NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved        BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_slots_date ON slots (slot_date);
CREATE INDEX IF NOT EXISTS idx_slots_status ON slots (status);
CREATE INDEX IF NOT EXISTS idx_leads_paid ON leads (paid);

-- Each (date,time) can now hold MULTIPLE seats (one row per seat), so the
-- old one-row-per-time uniqueness is dropped.
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_slot_date_slot_time_key;
CREATE INDEX IF NOT EXISTS idx_slots_date_time ON slots (slot_date, slot_time);
