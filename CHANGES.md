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
