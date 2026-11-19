# Finance: sales follow the invoices automatically + weekly / monthly bar graphs
- Finance (menu "Finance") now builds its sales LIVE from the invoices every time it opens: every PAID invoice counts (refunded,
  pending and draft ones do not), including online orders, offline sales restored after sync, and anything a worker rings up.
  Nothing is copied, so figures can never go stale or be entered twice. Same definitions as Wallet: income = paid invoices +
  manual income; expenses = expense entries (stock purchases already create these).
- Summary cards for the current week or month: Sales (from invoices, with the invoice count), Other income, Expenses, Net.
- Two bar graphs with a Weekly / Monthly switch (last 12 weeks, Monday-Sunday, or last 12 months): Income (sales from invoices and
  other income stacked in two colours) and Expenses. Amount labels on the bars, hover/tap for the exact figures of a period.
  Drawn as plain SVG: works offline, no chart library needed.
- The list below shows one automatic "Sales - auto" row per day (with a "View invoices" link that opens the Invoices page filtered
  to that day) plus every manual income/expense entry, newest first; first 60 rows, "Show all" for the rest.
- Heads-up: if a client already typed their daily sales in as manual "Income" entries, those now appear in addition to the
  automatic sales and would be counted twice. They should delete those entries.
- Display only: works for all existing clients immediately. Service worker cache `bh-offline-v20`.

# Invoices grouped by day / week / month, with a date filter
- Date filter above the list: From / To date pickers (either can be left empty for open-ended) and quick buttons Today, Yesterday,
  This week, This month, Last month, plus Clear dates. The filter is applied before grouping, so it works with Daily / Weekly /
  Monthly and the counts and paid totals follow it; a summary line shows "N of M invoices - range - paid total". If From is
  after To they are swapped; no matches shows a clear message. With a filter on and 5 or fewer periods, all periods open by default.
  Invoices with no date are left out while a filter is active. Service worker cache `bh-offline-v19`.
- Invoices page no longer lists everything in one long table. A Daily / Weekly / Monthly switch groups invoices under period
  headers (newest first): "Thursday, 19 Nov 2026 - Today", "Mon 16 Nov - Sun 22 Nov 2026 - This week" (weeks run Monday-Sunday),
  "November 2026 - This month". Each header shows the number of invoices and the PAID total (refunded/pending are counted as
  invoices but not in the paid amount, same rule as the rest of the app).
- Only the newest period is open; the others are collapsed. The page remembers what you opened/closed and the chosen view while you
  move around the app. "Expand all" / "Collapse all" buttons. A period with more than 100 invoices shows the first 100 and a
  "Show all N invoices" button.
- Dates follow Kenya time; an invoice with no date uses the Kenya date of its timestamp, otherwise it goes under "No date".
- Works for every existing client immediately (display only, no data changed). Service worker cache `bh-offline-v18`.

# Plan / trial expiry alerts
- Every business now has a real expiry: free trial = `trialEndsAt` (3 days), paid plan = `planExpiresAt` (30 days from
  activation; renewals are added on top of the time still left). A plan runs until the END of its expiry day, 11:59 PM Kenya time.
- Clients see it automatically: a banner on EVERY page (amber when almost over, red in the last 24 h and after it has ended)
  with the exact date/time (e.g. "Tue, 24 Nov 2026, 11:59 PM EAT"), a live countdown ("5 days 13 h left") and a Renew button, plus a
  popup once a day when they open the app. Paid plans warn 7 days ahead; the 3-day trial warns during its last 2 days. Outside
  those windows the dashboard shows a calm "active until ..." line.
- Email (only if SMTP is configured, same settings as password recovery): owners get an email at 7, 3 and 1 day(s) before a
  paid plan ends (1 day for trials) and once after it ended. Checked every 6 hours; an email is marked as sent only after it
  was really delivered, so a failed send is retried. Each reminder is sent once per expiry date.
- Admin: Businesses table shows plan/trial state, time left and expiry date; "Needs your attention" lists trials AND paid plans
  that are ending/ended; new "+30 days" button (and the expiry date can be set via the API). Choosing a plan or confirming a
  client's payment sets the expiry automatically; re-selecting the same plan does not extend it.
- Existing paid clients (they had no expiry): on first start they get last payment + 30 days, or 7 days from now if that
  date has already passed, so they receive the alerts and a chance to renew instead of being shown as expired at once.
- Owners cannot change `planExpiresAt` (server-controlled). Expiry only ALERTS; it does not lock or suspend a paid plan
  (the free trial paywall works as before).
- Service worker cache `bh-offline-v17`; tests/api-smoke.js now has 84 checks.

# Kenya time (EAT, UTC+3) for every business
- Audit log (and stock movements, plan-payment alerts, tickets, last backup, worker shift times, report timestamps) were shown
  in raw UTC, 3 hours behind Kenya. They are now always displayed in Nairobi time, whatever the device's own time zone is.
- Server runs on Kenya time (`TZ=Africa/Nairobi`), so "today", trial dates, online/marketplace order dates and backup file
  names follow Kenya's calendar even on a UTC host (before, orders placed 00:00-03:00 got the previous day's date).
- POS "today" on the device is the Kenya date. Every business (new and existing) now carries `timezone: Africa/Nairobi`;
  the Timezone box in business setup is fixed and cannot be changed. Stored timestamps remain UTC instants, so no existing
  data was altered.
- Service worker cache `bh-offline-v16`.

# Audit log: actions visible, offline entries sync, no sales details for the platform admin
Applies to ALL existing clients automatically: no data is deleted or converted by hand, and old app versions keep working.

- Audit entries now live INSIDE each business (`auditLogs`), so they are saved and uploaded together with the business.
  Before, they went to a device-wide list that was never sent to the server, so refunds, shifts, workers, permission
  changes and offline events never reached the admin's Audit log.
- Offline: entries made without internet are marked "offline" and uploaded on the next sync (reconnect, login or the
  Sync button). The server merges entries from every device by id: several offline devices can all upload, a stale or
  old-version device can never wipe them, and existing entries cannot be edited. The server stamps the sync time.
- Offline sales queue: queued sales are put back into the business they were made in (before: whichever business was
  open), and the queue is cleared only after the server really received the data (before: it was never cleared and
  "offline_sales_synced" was never logged).
- Admin > Audit log: every action has a readable, colour-coded label (Sale, Refund, Shift started, Permission changed,
  Worker added, Offline sales synced ...). Before, the action text used a dark colour that was invisible in the admin
  dark theme. Offline entries show "offline - synced <time>".
- Platform admin can no longer see invoice numbers or prices of client sales in the Audit log. Sale / refund / online and
  marketplace order rows show only who, when, which business, number of items and payment method. This is enforced on
  the SERVER for every row (old and new) and the admin search also runs on the hidden-text-free rows, so an invoice number
  or an amount cannot be searched for either. Business owners still see everything in their own business.
- Existing clients: their past sales, expenses and workers still appear in the admin log (derived from their data, with
  prices hidden). Entries that older app versions had stored on a device are moved into the business the first time that
  owner opens the updated app (the owner's only business, or the business that has the invoice number they mention;
  entries that cannot be attributed safely stay on the device).
- Service worker cache `bh-offline-v15`: installed apps download the update the next time they open while online.
- tests/api-smoke.js: 13 new checks (79 total).
Not changed on purpose: expense amounts still show in the admin Audit log; the admin "full platform backup" file still
contains complete business data (it exists for disaster recovery).

# Fixes in the latest verification pass
- Customers can now order from their OWN phone: the shop list / shop page / checkout use the server's public API
  (/api/public/shops...). Before, the store only listed shops saved in the same browser, so anyone else saw "No shops".
  Server prices the order, checks + deducts stock, and the owner's app picks new orders up within ~20 s (toast + list).
  Local/no-server mode still works as before.
- Server: public order lines are whitelisted, orders carry orderStatus NEW / paymentStatus PENDING (shown under NEW),
  public products include sourceCat so shops show one section per business category.
- FIXED: recording a supplier purchase crashed ("qty is not defined") and saved nothing - stock + expense now update.
- FIXED: refunding a POS sale restored raw quantity (refund of 10 m of a 100 m roll added 10 rolls). Now unit-aware.
- FIXED: a local online order deducted stock twice and skipped order numbers.
- FIXED: cancelling an online order from the status dropdown did not put stock back.
- FIXED: wallet/trend chart buckets used UTC dates; in Kenya (UTC+3) the monthly chart ended last month and the
  daily chart broke 00:00-03:00. Now local dates.
- Register password hint said "Min. 4"; the server requires 8.
- Offline: account creation and password reset now save the offline login (before, only typing the password on the
  login form did), and login falls back to the on-device login when the server is unreachable but the browser says
  "online". Clear message when an account was never logged in on that device.
- Offline shell: service worker (v7) no longer ignores failed downloads - it re-fetches any missing file (page, styling
  engine, charts) on activate, when the app comes online and on request, so an offline refresh can't end up unstyled.
- Cart: discount is now an amount in KES (was %); per-item "Sell price" box to sell above/below the registered price
  (stored on the invoice, registered price kept as listPrice; resets when the unit changes); "✕ Remove" on every cart
  line; discount no longer carries over to the next sale; discount box keeps focus while typing; payment/discount/barcode
  layout fixed (a missing </div> squeezed them into the payment-method grid). Old invoices with % discounts still display.
- Stock display: items sold in parts now show full packs + the open pack ("19 full + 1 open (95 m)") on the POS tile,
  Stock page, Products page, dashboard low-stock and stock warnings; each cart line shows "In stock ... after this sale ...".
  (Underlying stock is unchanged: a number of whole items, e.g. 19.95.)
- tests/api-smoke.js: 66 server checks (run against a fresh DB: BASE_URL / ADMIN_EMAIL / ADMIN_PASSWORD env vars).

# Fixes in this build
## Pricing / products (index.html)
- ONE pricing engine (calcCartPricing). Cart subtotal/total/checkout now use it (they used a second formula reading
  packSize/packSizeUnit that products never had -> 10 m of a 100 m / KES 2800 roll was charged 28,000 instead of 280).
- Pack size + pack unit inputs in the Products table are now actually saved (they were never read).
- Whole-item unit / pack unit edits mark the product "reviewed" so "Apply categories" no longer resets them.
- Stock is deducted in the whole-item unit (selling 10 m of a roll = 0.1 roll, not 10 rolls). Stock checks convert too.
- New units: roll, bottle, tin, bag, pair, carton, bundle (catalog "per roll"/"per bottle"... used to collapse to "pc").
- unitMeta: "per month" no longer becomes metres; pack/set no longer treated as interchangeable with pc.
- Cart unit dropdown shows only sensible units; warns when no pack size is set for the chosen unit.
- Admin password reset no longer uses "1234" (server needs 8+ chars, so it always failed); client min length 8.
## Server (server.js)
- SECURITY: /api/auth/forgot returned the recovery code to whoever asked (account takeover with just an email).
  Now the code goes to the admin alert only, is stored hashed, rate-limited, 5 tries, sessions revoked after reset.
- SECURITY: public shop endpoint leaked cost price/batch/etc; now whitelisted fields only.
- Backups: owners can only write to their own folder. Added jpg mime type. Removed duplicate plan key.

# Round 2
- Plans: owners can no longer set plan/planPaidAt/planReceipt. Paying creates a payment claim (POST /api/businesses/:id/plan-request)
  and an admin alert; the admin confirms by choosing the plan (clears the claim).
- Lost updates: when a device saves with an out-of-date order list, the server keeps orders made elsewhere (online shop, other
  till/worker) and subtracts their stock from the incoming product stock.
- Backups: BACKUP_DIR (persistent volume) + BACKUP_KEEP retention (was unlimited, ephemeral).
- Login lockout now counts failed attempts only and is keyed per email+IP.
- Unknown asset URLs return 404 (were answered with index.html).
- Invoice unit change reprices from pack data; cancelling an online order restores stock in product units.
- Unload save uses fetch keepalive with auth (sendBeacon could not authenticate).
- Icons: real 512x512 icon, properly padded maskable icon, 256 icon fixed, logo.png is now a real PNG.

# Round 3
- Worker limits enforced per plan (Free 1, Starter 3, Pro 10, Business 50, Enterprise 999 – editable in Admin → Plans).
  Both add-worker forms are blocked at the limit with an upgrade message, and both worker sections show "Workers: n / limit".
  The server also enforces it on save (existing workers are kept, extra new ones dropped), so it can't be bypassed.
  Downgrading never deletes existing workers; it only blocks adding more.

### Admin dashboard layout and dark theme
- The super-admin sidebar now sits beside the content on desktop (stacks only on phones). The CSS fallback utilities in `public/index.html` were marked `!important`, which overrode Tailwind's responsive classes and the admin dark theme. Removed `!important`; dark mode now shows dark cards with light text.

### Bulk product variants
- Products page: new "Add many variants at once" panel (choose the business category and a subcategory from that category, or type a new subcategory). Enter the product name once, then one row per company / pack size (price, cost, opening stock, reorder). Each row becomes its own product named "Name - Company - 20 kg", with its own SKU, barcode, price and stock. Duplicate names are refused.
- Fixed: barcodes generated in the same millisecond could be identical (also affected "Generate missing barcodes"); they are now always unique.

### Search boxes and deleted products
- Search boxes (Shop, Stock, Products) no longer lose focus or stop after a few letters: Products search had no handler at all, Stock search's handler was overwritten, and the page redraw dropped the cursor. The cursor is now kept across redraws.
- Deleted products now stay deleted: deletions are remembered (tombstones) on the device and on the server, so "Merge catalog products", a stale browser tab or another device cannot bring them back.

### Login on a new device, password recovery, sync after offline
- Accounts created on a device with no server connection (offline) existed only on that device, so other devices said "Invalid email or password". When the server is reachable the app now registers those accounts on the server (same email and password), moves their business under the server account and uploads the data.
- Server: creating a business keeps the id the device already uses, so later syncs update it instead of creating copies / hitting the plan business limit.
- "Get recovery code" did nothing: the hidden new-password fields were marked required and the browser silently blocked the form. Fixed. Clicking Update password with no code now says to enter the code.
- Optional email for recovery codes: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (see .env.example; uses nodemailer, run `npm install`). Without it the admin still gives the code from the Alerts tab.
- Black screen after going back online: the app waited for the network before drawing anything. It now draws immediately, requests time out after 20 s, the server check waits 8 s and retries every 15 s, and a "Synced to server" message shows when the sync completes.

### Plan payment alerts for the admin
- When a client submits a plan payment, the admin now sees a highlighted banner on every admin page with the business, plan, M-Pesa receipt and phone, plus red badges on Dashboard and Alerts. The admin page checks for new payments every 20 s while open (no refresh needed) and plays a sound, shows a toast, updates the tab title "(1) ..." and can show a desktop pop-up ("Turn on pop-up alerts" button).
- One-click "Payment received - activate <plan>" (sets plan, keeps the receipt, clears the request) or "Reject". Optional email to the admin when SMTP is configured (ADMIN_NOTIFY_EMAIL, or the admin account email).

### Thermal receipt printer
- Settings > Thermal receipt printer: connect once (USB, or Bluetooth/serial paired printer). After that the printer is detected automatically when plugged in / switched on (status shown in Settings and under the POS cart), and every completed sale (cash, M-Pesa, credit, workers too) prints an ESC/POS receipt with no dialog and auto-cut. 58 mm / 80 mm, test print, "Print receipt again" button, auto-print on/off. Chrome or Edge required (WebUSB / Web Serial); the browser asks permission once per device.

### Installed app (PWA)
- Service worker cache bumped to v8 so installed copies download all of the above. An installed app now reloads itself onto the new version when nobody is mid-sale (open sale, form or window); otherwise it shows the "new version ready" bar.
- Manifest no longer locks the installed app to portrait, so POS works on desktop and landscape tablets.
- Printer (WebUSB / Web Serial) and admin pop-up alerts work in the installed app as well as in the browser tab.

### Password recovery: code delivery
- Bug: every click of "Get recovery code" created a NEW code and cancelled the previous one, so a code the admin had passed on (or an older alert's code) said "Invalid or expired recovery code". An active code is now kept for its 30 minutes, however many times it is requested.
- The admin no longer copies codes by hand. The client's recovery page waits ("Waiting for admin approval...") and the admin presses "Approve - send code to client's page" on the Alerts tab (admins also get a toast and a badge for new requests). The code then appears on that client's page by itself and is filled in. It is released only to the browser that made the request and only after approval, so typing someone else's email never reveals their code.
- With SMTP configured the code is emailed to the account instead (no admin step).

# Grouped dark sidebar (owner app)
- Replaced the flat 21-button list with a dark sidebar grouped into Sales / Catalog / Customers / Finance / Delivery / Manage,
  with line icons, an accent bar on the active item, collapsible group headings (remembered per device), a "Search menu" box,
  and a user card with log out at the bottom.
- Live badges: new online orders (red), low/out-of-stock products (amber), items in the cart (grey).
- Mobile: hamburger button in the header opens a slide-in drawer with a dimmed backdrop (tap to close); it closes after choosing a page.
- The duplicate "Online store" / "Online orders" entries (both opened the same page) are now one item, "Online orders".
- The business switcher only appears when you own more than one business.

### Recovery code: no more lost codes
- Recovery-code requests, approvals and resets now update the stored codes under a database row lock. Two requests at the same moment (two clients, or a double click) could overwrite each other and make a valid code disappear ("invalid or expired").
- The reset error now says what is wrong: no active request for that email, code expired, or wrong code (with attempts left).

## Test pass on the account-sync + marketplace version
- Marketplace checkout always failed (500): rewritten to run in one locked transaction, with stock and quantity checks.
- Marketplace config/stats endpoints crashed (missing `requireAuth`): added.
- Marketplace JSON-LD could be broken by seller-controlled names: now escaped.
- Platform audit log and recovery tokens no longer lose entries under concurrent requests (row-locked updates).
- Opening the Marketplace from the landing page showed "No matches" until a search was made: it now loads offers on open.
- Duplicate "Marketplace" sidebar item removed.
- Service worker cache bumped to `bh-offline-v9` so installed apps pick up the update.
- Recovery-code errors are specific (expired / wrong code / too many tries).

## Backups include everything
- "Download business backup" now takes the freshest copy from the server (workers, orders from other devices, online/marketplace orders) and records counts of what it holds.
- Restoring a backup now really restores: products deleted since the backup come back, and newer orders no longer override it. Workers come back with it (up to the plan's worker limit).

## Portrait and landscape on phones
- The slide-out menu layout now also applies to phones turned sideways (previously the desktop sidebar appeared and ate the screen).
- Landscape gets compact headers, padding and menu spacing; modals scroll within the short screen; notch/safe-area padding added.
- Service worker cache bumped to `bh-offline-v10`: installed clients pick up all changes on next open while online.

## Purchases: quick add + confirm
- Purchases lists every product with search; tap +1 / +2 / +3 / +4 / +5 (repeat taps add up) or Custom.
- A "This purchase" panel shows the items; quantity and unit cost are editable, supplier is optional (no supplier needs to exist).
- "Confirm purchase" records the purchases, adds the quantities to stock and logs the cost as an expense. Cache bumped to v11.

## Products, Shop and Stock: A-Z and grouped by name
- Items are sorted alphabetically in Products, Shop (POS), Stock overview, and the product pickers.
- Products sharing a name (e.g. "Kienyeji layers - Kenchic - 20 kg", "Kienyeji layers - Hybrid - 50 kg") appear once under "Kienyeji layers"; tap it to open the variants. While searching, matching groups open automatically. Single items show as before. Cache bumped to v12.

## Sidebar look and themes
- Sidebar menu text is bold italic (owner, worker and admin menus).
- New sidebar colour styles in Settings > Appearance: Midnight, Ocean, Forest, Plum, Sunset, Rose, Teal, Slate, Light. "Automatic" picks Midnight in dark mode and Ocean otherwise. The white sidebar is never used in dark mode.
- New page backgrounds: Ocean blue, Fresh mint, Rose pink, Lavender, Sunset (beside Light, Dark, Teal, Warm).
- Dark theme fix: coloured tiles (sales, income, expenses, profit etc.) no longer show dark text on dark cards. Dark and light styles are kept fully separate. Cache bumped to v13.

## USB HID scanner + printer, and Worker management
- Barcode scanners (USB / wireless, 1D/2D, hands-free, keyboard-wedge): no driver or connect step. Scans are caught anywhere in the app, even with no field focused, and a scan never lands as typed text in a search box. The Enter (or Tab) suffix is used when present; scans without a suffix are detected from their speed. Human typing is never mistaken for a scan.
  - Shop: adds to cart. Purchases: +1 on the purchase list. Stock: shows the item. Products: "Scan to build catalogue" (new item: asks name, price, stock, SKU auto; or count mode: +1 stock per scan).
  - Link barcodes to catalogue: click an item's Barcode box (table or new-product form) and scan - it fills the box and jumps to the next item.
  - Settings > Barcode scanner: on/off, beep, Enter-suffix instructions and a live scan test.
- Printer: added USB HID printer connection (WebHID) beside USB (WebUSB, bulk and interrupt endpoints) and Bluetooth/serial; auto-detected on plug-in. HID path is untested on real hardware.
- New sidebar group "Worker management": Workers (add, edit, suspend, remove, reset password), Shifts (start/stop per worker, several at once, opening/closing cash, history), Permissions (tick/untick menus per worker, role presets), Performance (sales, revenue, items, hours, KES/hour, commission, CSV), Schedule (weekly roster, repeat weekly, today's roster with late flag).
- Sales now record time and the shift they belong to; "require shift before sale" is checked per worker. Suspended workers are logged out and cannot sign in. Cache bumped to v14.
