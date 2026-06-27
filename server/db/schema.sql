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
-- Per-funnel settings: the same key can hold a different value per funnel, so
-- 'paid' and 'free' each have their own video/thumbnail/reveal/etc. Existing
-- rows become 'paid'. PK becomes (key, funnel).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS funnel TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_key_funnel_pk') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_key_funnel_pk PRIMARY KEY (key, funnel);
  END IF;
END $$;

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
ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_phone TEXT;        -- contact the payer typed in Razorpay
ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_status TEXT;       -- 'success' | 'failed' | null
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wa_payment TEXT;           -- payment WhatsApp: 'success' | 'failed' | null
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wa_1h_sent BOOLEAN NOT NULL DEFAULT false; -- 1-hour-before reminder fired
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hc_status TEXT;            -- health-check status ('done' once the HC form is filled)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hc_data JSONB;             -- health-check form (sugar/age/gender/detox/etc.)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted BOOLEAN NOT NULL DEFAULT false; -- admin-toggled: lead is converted (enrolled/closed)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_alert_sent BOOLEAN NOT NULL DEFAULT false; -- internal 'lead finished video' alert fired (once)

-- WATI WhatsApp inbox — every inbound/outbound message, for the chat page.
CREATE TABLE IF NOT EXISTS wa_messages (
  id          BIGSERIAL PRIMARY KEY,
  wa_id       TEXT NOT NULL,            -- the customer's WhatsApp number (91…)
  name        TEXT,                     -- sender display name (from WATI)
  direction   TEXT NOT NULL,            -- 'in' (from customer) | 'out' (we sent)
  text        TEXT,
  type        TEXT DEFAULT 'text',
  wati_id     TEXT,                     -- WATI message id (dedupe)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_thread ON wa_messages (wa_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_messages_watiid ON wa_messages (wati_id) WHERE wati_id IS NOT NULL;

-- Staff accounts created from the admin Users page (name + phone + password).
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT UNIQUE NOT NULL,
  pass_salt   TEXT NOT NULL,
  pass_hash   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE slots ADD COLUMN IF NOT EXISTS release_wave INTEGER;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT false; -- admin-assigned seat (not a real Razorpay payment) — deletable, unlike paid bookings
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT; -- 'meta' (came from a Meta/FB ad) | null/other = WhatsApp/organic
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_detail TEXT; -- which Meta ad/campaign (from the ad URL's utm_campaign / utm_content params)

-- ============================================================
-- Multi-funnel: 'paid' (the original ₹ VSL) and 'free' (no-payment masterclass
-- copy). Every lead/slot/setting/testimonial is tagged so the two funnels share
-- code but never share data. Existing rows default to 'paid'.
-- ============================================================
ALTER TABLE leads        ADD COLUMN IF NOT EXISTS funnel TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE slots        ADD COLUMN IF NOT EXISTS funnel TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS funnel TEXT NOT NULL DEFAULT 'paid';
CREATE INDEX IF NOT EXISTS idx_leads_funnel ON leads (funnel);
CREATE INDEX IF NOT EXISTS idx_slots_funnel ON slots (funnel);

-- WATI inbox read-state: when the admin last opened each conversation. Inbound
-- messages newer than this count as unread (shown as a badge in the chat list).
CREATE TABLE IF NOT EXISTS wa_reads (
  wa_id    TEXT PRIMARY KEY,
  read_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-date publish toggle. active=false hides the whole date from the public
-- booking calendar (admin still manages it). Missing row = active (default on).
CREATE TABLE IF NOT EXISTS slot_days (
  slot_date  DATE PRIMARY KEY,
  active     BOOLEAN NOT NULL DEFAULT true
);
-- Per-funnel publish toggle: each funnel can show/hide a date independently.
ALTER TABLE slot_days ADD COLUMN IF NOT EXISTS funnel TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE slot_days DROP CONSTRAINT IF EXISTS slot_days_pkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slot_days_date_funnel_pk') THEN
    ALTER TABLE slot_days ADD CONSTRAINT slot_days_date_funnel_pk PRIMARY KEY (slot_date, funnel);
  END IF;
END $$;

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

-- Payments log: one row per confirmed transaction. A customer who pays twice
-- gets two rows (deduped only by the unique Razorpay payment_id). The leads
-- table stays one-row-per-person; this is the per-transaction record.
CREATE TABLE IF NOT EXISTS payments (
  id              SERIAL PRIMARY KEY,
  payment_id      TEXT NOT NULL UNIQUE,
  order_id        TEXT,
  phone           TEXT,
  name            TEXT,
  amount          NUMERIC NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'INR',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_phone ON payments (phone);

CREATE INDEX IF NOT EXISTS idx_slots_date ON slots (slot_date);
CREATE INDEX IF NOT EXISTS idx_slots_status ON slots (status);
CREATE INDEX IF NOT EXISTS idx_leads_paid ON leads (paid);

-- Each (date,time) can now hold MULTIPLE seats (one row per seat), so the
-- old one-row-per-time uniqueness is dropped.
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_slot_date_slot_time_key;
CREATE INDEX IF NOT EXISTS idx_slots_date_time ON slots (slot_date, slot_time);
