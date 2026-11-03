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
