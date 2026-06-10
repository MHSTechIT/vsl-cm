# VSL Funnel — Backend (Phase 2)

Node/Express API + PostgreSQL for the diabetes-reversal funnel: leads, watch-time,
slot booking with holds, ₹99 payment (Razorpay), WhatsApp (Whapi.cloud), admin panel.

## Setup

```bash
cd server
npm install
cp .env.example .env        # then edit .env (DB password, tokens)
npm run db:setup            # creates the database + tables on your server
npm run dev                 # API on http://localhost:8787
```

Then run the frontend from the repo root: `npm run dev` (Vite proxies `/api` → 8787).

- Funnel page: http://localhost:5173/
- Admin panel: http://localhost:5173/admin  (token = `ADMIN_TOKEN` from `.env`)

## Going live (currently in mock/manual mode)

Edit `server/.env`:

| What | Now | To go live |
|---|---|---|
| Payments | `RAZORPAY_MODE=mock` (fakes ₹99) | set `RAZORPAY_MODE=live` + `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` |
| WhatsApp | empty `WHAPI_TOKEN` → leads flagged `needs_wa` in admin | set `WHAPI_TOKEN` (Whapi.cloud) for auto-send |
| Video | placeholder + dev controls | set `VITE_VSL_SRC` in the frontend `.env` to the real video URL |
| Admin | `ADMIN_TOKEN=change-me-admin-token` | change to a strong secret |
| DB SSL | `DATABASE_SSL=false` | `true` if your Postgres requires SSL |

## Security
- `.env` is gitignored — never commit real credentials.
- Only the backend talks to Postgres; the browser never connects directly.
- Lock the DB host so only the backend can reach port 5432.

## API (summary)
- `POST /api/leads` — Form 1 (name, phone)
- `POST /api/leads/:phone/progress` — watch checkpoint (25 / 8min / 15min / finished)
- `GET /api/slots/dates`, `GET /api/slots?date=` — calendar
- `POST /api/slots/hold` — Form 2 select (pending hold)
- `POST /api/payment/order`, `POST /api/payment/verify` — ₹99 + confirm
- `GET /api/admin/{stats,leads,slots,settings}`, `POST /api/admin/slots[/close]`,
  `POST /api/admin/leads/:phone/wa-sent` — admin (Bearer `ADMIN_TOKEN`)
