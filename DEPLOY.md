# Deploy BusinessHub Kenya (any host)

The app is one Node.js service plus one PostgreSQL database. Every host below offers both,
so you are not tied to any of them. Data lives in Postgres, so redeploys and restarts never lose it.

## 1. Get a PostgreSQL database
Pick one (check each provider's current free-tier limits first):
- **Railway / Render / Fly.io**: add a Postgres database to your project.
- **Neon or Supabase**: free hosted Postgres you can use with any host.
Copy its connection string (`postgres://...`).

## 2. Deploy the app
Push this folder to GitHub, create a Node web service from the repo on your host, and set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Postgres connection string |
| `ADMIN_EMAIL` | your admin login email |
| `ADMIN_PASSWORD` | a long password (min 8 chars) |
| `DATABASE_SSL` | `true` only if your provider needs SSL and the URL has no `sslmode=` |

Build command: `npm install`  Start command: `node server.js`  (Railway and Render configs are included.)

## 3. First login
Open your URL and log in on the **admin login** screen with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
The admin account is created from these variables on first start; public admin signup is disabled.
After the first login you can delete `ADMIN_PASSWORD` from the host's environment.

## Moving old data from `db.json`
```bash
npm install
DATABASE_URL=postgres://... node migrate-json.js path/to/db.json
```
Plain-text passwords are hashed during import. Everyone logs in again afterwards.

## Custom domain
Host dashboard → Domains → add your domain, then create the DNS record it shows.

## Backups
Admin → Backup downloads everything as JSON. Also turn on your database provider's automatic backups.

## Run locally
```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/bh ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=change-me-now node server.js
```
Open http://localhost:3847
