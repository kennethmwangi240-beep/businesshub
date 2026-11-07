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
