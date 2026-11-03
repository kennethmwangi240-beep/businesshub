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

## Updating the live app
1. Change the files (on your computer, or edit on GitHub with the pencil icon).
2. Commit to the `main` branch. Render rebuilds and redeploys automatically (about 1 minute).
3. Open the site and check it. Installed copies on client laptops pick up the update the next time they open the app.
Tips: download a backup (Admin → Backup) before big changes; database tables are created with
`CREATE TABLE IF NOT EXISTS`, so adding new tables is safe, but renaming or deleting columns needs a careful migration.

## Installing the app (clients and admin)
There is now an **Install app** button in the client dashboard (top bar, sidebar and a banner on the dashboard), on the home and login pages, and in the admin dashboard header.
- **Chrome / Edge (laptop or Android):** click **Install app**. A desktop shortcut or home-screen icon is created and the app opens in its own window.
- **iPhone / iPad:** open in Safari → Share → **Add to Home Screen** (the button shows these steps).
- If the browser has not offered the native prompt yet, the button shows step-by-step help instead.
- The admin can install the same way: open the site, go to Admin login, then press **Install admin app** or **Install app**.
It needs HTTPS (Render provides it). The button hides itself once the app is installed.

## Forgot the admin password?
In your host's environment variables set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (new password) and `ADMIN_RESET=true`, redeploy,
log in, then delete `ADMIN_RESET` and `ADMIN_PASSWORD`.

## What is new in 2.1
- Install button everywhere, maskable icon and app shortcuts (Shop, Invoices, Stock) in the manifest.
- Admin dashboard: 7 colour themes + dark mode (remembered on this device), clickable colour stat cards, plan and signup charts, monthly revenue, "needs attention" list for expiring trials, client search and CSV export.
- Clients: low-stock alert on the dashboard, offline banner, auto re-sync when back online, "new version ready" refresh bar.
