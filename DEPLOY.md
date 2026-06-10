# Deploy for testing — Backend (Render) + Frontend (Vercel)

Architecture: **Vercel** serves the React/Vite app (landing + `/admin`); **Render**
runs the Node/Express API which talks to your PostgreSQL at `13.202.225.50`.

```
Visitor / Admin ──▶ Vercel (frontend)
                       │  calls VITE_API_URL
                       ▼
                    Render (backend API) ──▶ Postgres (13.202.225.50)
                                          ├▶ Razorpay
                                          └▶ Whapi (WhatsApp)
```

Prerequisites: the repo is on GitHub (done: `MHSTechIT/vsl-cm`), a free
[Render](https://render.com) account, and a free [Vercel](https://vercel.com) account.

---

## STEP 1 — Deploy the backend on Render

1. Render dashboard → **New → Web Service** → connect the GitHub repo `vsl-cm`.
2. Settings:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
   - Plan: Free
3. Add **Environment variables** (Render → Environment):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | `postgres://postgres:<YOUR_DB_PASSWORD>@13.202.225.50:5432/vsl_funnel` (URL-encode special chars, e.g. `$` → `%24`) |
   | `DATABASE_SSL` | `false` |
   | `HOLD_WINDOW_MINUTES` | `12` |
   | `RAZORPAY_MODE` | `mock` (switch to `live` + keys later) |
   | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | (blank for now) |
   | `PRICE_PAISE` | `9900` |
   | `WHAPI_TOKEN` | (blank → leads flagged for manual WhatsApp) |
   | `WHAPI_BASE_URL` | `https://gate.whapi.cloud` |
   | `ADMIN_TOKEN` | a strong secret (replaces `123456`) |
   | `CORS_ORIGIN` | leave blank for now — set in Step 3 |

   > Note: `PORT` is provided automatically by Render — don't set it.
4. **Create Web Service**. When it's live you get a URL like
   `https://vsl-backend.onrender.com`. Open `…/health` — it should return `{"ok":true}`.
   (If it shows a DB error, your Postgres must allow connections from Render — see Notes.)

---

## STEP 2 — Deploy the frontend on Vercel

1. Vercel → **Add New → Project** → import the same GitHub repo `vsl-cm`.
2. Vercel auto-detects **Vite** (Build `npm run build`, Output `dist`). Leave the
   **Root Directory** as the repo root (`./`). `vercel.json` handles `/admin` routing.
3. Add **Environment Variable**:

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | your Render URL from Step 1, e.g. `https://vsl-backend.onrender.com` |

   (No trailing slash.)
4. **Deploy**. You get a URL like `https://vsl-cm.vercel.app`.

---

## STEP 3 — Connect the two (CORS)

1. Back in **Render → Environment**, set:
   - `CORS_ORIGIN` = your Vercel URL, e.g. `https://vsl-cm.vercel.app`
2. Save → Render redeploys. Done.

---

## STEP 4 — Test

- **Admin:** `https://vsl-cm.vercel.app/admin` → log in with your `ADMIN_TOKEN`.
  - Upload page → upload a video + thumbnail, set the booking-reveal time.
  - Slots → open a date, set seats per time.
- **Landing:** `https://vsl-cm.vercel.app/` → press play → enter name + WhatsApp →
  video plays → after the reveal time the booking CTA appears → pick a slot →
  ₹99 (mock) → "Slot confirmed". Check it shows in Admin → Leads.

---

## Notes & caveats (for testing)

- **Uploads are temporary on Render's free tier.** The `uploads/` folder is wiped on
  every redeploy/restart, so re-upload the video/thumbnail after a deploy. For
  permanent storage, add a Render **Disk** (paid) or switch to object storage later.
- **Free Render services sleep** after ~15 min idle; the first request then takes
  ~30–50s to wake. Fine for testing.
- **Database access:** Render must be able to reach `13.202.225.50:5432`. It worked
  from here, so it likely accepts external connections — if Render shows an auth/
  connection error, allow Render's outbound IPs (or `0.0.0.0/0` for a trial) in your
  server's firewall / `pg_hba.conf`.
- **Razorpay webhook:** once on Render you no longer need a tunnel — use
  `https://vsl-backend.onrender.com/api/payment/webhook` as the webhook URL, set
  `RAZORPAY_MODE=live` + the keys + `RAZORPAY_WEBHOOK_SECRET`, and redeploy.
- **Change `ADMIN_TOKEN`** from `123456` before sharing the test link.
- Every `git push` to `main` auto-redeploys both Render and Vercel.
