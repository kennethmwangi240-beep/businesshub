## Backups folder

Server stores per-client backups under:

`data/businesshub/{client-email}/`

Optional email: set `RESEND_API_KEY` and `BACKUP_FROM_EMAIL` on the host.

# BusinessHub V3 Phase 1

Additive upgrade — **does not delete** existing businesses, products, sales, or users.

## What is new
- Expanded subscription plans: FREE, STARTER, PRO, BUSINESS, ENTERPRISE (configurable)
- Super Admin: Analytics (MRR/ARR), Support tickets, Payments summary
- Business settings: Workers roster, Support ticket form
- Platform stats API

## What is preserved
- All existing localStorage + PostgreSQL business JSON data
- Auth, POS, inventory, invoices, online shop, PIN, M-Pesa UI, backups

## Later phases (not in this build)
Multi-branch POS, offline sync, WhatsApp, mobile app, full AI engine, loyalty, delivery workers

## v2.1.1 fixes

- Notices publish to server so all clients see them
- Business saves queue + updatedAt (survives refresh)
- Chart.js and Tailwind served from /vendor (works offline after first load from your server)
- Wallet charts more reliable

# BusinessHub Kenya — Server

Node.js (18+) API + web app. Data is stored in PostgreSQL via `DATABASE_URL`, so it runs on any host.
See **DEPLOY.md** for setup and `.env.example` for all settings.

Security: scrypt-hashed passwords, 30-day expiring sessions (stored hashed), rate-limited login/signup/orders,
admin created from environment variables only, server-side order pricing and stock checks, CORS closed by default.
