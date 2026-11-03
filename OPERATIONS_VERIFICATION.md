# Arafat Traders — verification, 23 October 2026

Live app: https://akij-dealership-sami.tangylark256.chatgpt.site

Published version: 45. Source commit: `d15743a281dbfaf4b5619d00a71efde089f9f464`. Deployment succeeded on 23 October 2026.

## Implemented and verified

- Bounded initial replica pages (maximum 200 rows / 128 KiB), then ordered incremental changes with deletion events and reset epochs. The initial download still includes complete history for offline accounting; subsequent refreshes and saves avoid the full snapshot.
- Main lists show 50 records per page. All due/balance calculations retain complete history.
- Financial row changes append the verified account, role, operation ID and actual before/after values atomically. Failed writes roll back the event; safe retries do not duplicate it. Audit history is Admin-only and survives resets. Historical actions before this feature cannot be attributed retroactively.
- A 5,000-sale fixture measured 5,797,009 bytes for the old snapshot, 93,831 bytes for the largest new page, 127 bytes for idle sync and 321 bytes for one payment delta. These are fixture measurements.
- Live health returned HTTP 200 and the database probe succeeded. Main page, API and health responses passed CSP, nosniff, anti-framing, HSTS, referrer and permissions header checks.
- Live monitoring aggregates were readable by Admin: 12 buckets / 100 requests at the verification point. Route aggregates do not contain bodies or customer identifiers.
- A real private R2 backup was created, read back and downloaded. SHA-256 matched: `a7924a1ed82ae9024e521954513b49a7ed3fa4bb342d0a589b346619d83aa7a1`. Size: 26836 bytes.
- That cloud download restored to a fresh temporary SQLite/D1-compatible database. Every business row and durable operation ID matched; cash, bank, customer dues, company payable and stock matched. Temporary test databases were removed.
- The drill exposed and fixed restore ordering for stock funded by adjustments. It also now explicitly preserves and reports historical negative stock without weakening normal sale validation.

## Remaining limits / findings

- **Static asset headers remain missing on the live hosting route**, including `/offline-store.js`. The hosting gateway bypasses the declared Worker-first and `_headers` configuration. Local built-worker static headers pass; main page/API/health headers pass live. Hosting-level static header enforcement remains unresolved.
- Backups are **manual**; automatic daily snapshots and external uptime/error alerts are not configured.
- The restore drill was cloud R2 → isolated local database. Provider-side D1 disaster recovery/PITR retention, account-loss recovery and regional failover have not been verified.
- The live backup contains **2 pre-existing negative-stock products**: product IDs 189, 195. The private drill report contains their values. No live stock was changed; actual counts need checking through the app's Current Bag adjustment.
- Initial transfer and device storage still grow with total business history. The incremental protocol reduces repeated network transfers; it does not make the local full replica constant-size.

## Private evidence

- `data/backups/live-operations-check.json`: live response headers, monitoring and backup checksum.
- `data/backups/cloud-restore-drill-report.json`: row and balance equality, retained history and historical stock anomalies.
- `data/backups/cloud-drill-fbce7a0b-8954-47c8-981a-ef77a11b8dc9.json`: verified downloaded cloud backup; keep private.
- `online-site/OPERATIONS.md`: operating and recovery instructions.

Validation: final lint passed with 0 errors / 0 warnings; TypeScript passed; all 17 Node test files passed, including six operations cases. Production build passed and version 45 deployed successfully. Earlier built-Worker HTTP checks covered login/session/rate limits, financial write validation, compact commands, audit authorization, private R2 roundtrip and headers. Mobile/desktop browser checks covered pagination, real IndexedDB reload and incremental sync. The real cloud backup restore report passed after the recovery safeguards were corrected.

No APK was built.
