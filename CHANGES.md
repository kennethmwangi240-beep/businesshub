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
