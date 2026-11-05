# BusinessHub V3 — scope of this build

## Shipped in this web platform (working)
- Existing: auth, multi-business, POS shop, stock, products, purchases, customers, invoices, expenses, reports, online store, M-Pesa UI, PIN, plans, admin, backups, support tickets
- V3 added: AI assistant (data-backed Q&A + insights), stock forecast, branches list, workers roster, delivery tracking, loyalty rules, expanded admin analytics & plans

## Not shipped as native products (require separate projects)
- Android/iOS app stores binaries
- Official WhatsApp Business API (needs Meta business verification)
- Full offline-first conflict-free multi-device CRDT POS
- Production ML models
- Pesapal/Flutterwave live card capture without merchant keys
- Custom domains automation

These can use the same APIs later. Existing Postgres business data is not wiped by this upgrade.
