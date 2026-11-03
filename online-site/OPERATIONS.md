# Sync, audit and operational recovery

## Data transport and display

The browser authenticates before reading its encrypted device replica. First login downloads all business history using keyset pages (at most 200 records with a 128 KiB page target). It records the starting journal revision before paging, then applies ordered changes to reconcile writes that happened during the download. Initial total download still grows with history; this is a complete offline replica, not partial-history accounting.

Subsequent refreshes use `/api/replica/changes`. Commands request protocol 2 and receive a compact operation result; the durable outbox reconciles deltas before removing the accepted operation. A disconnected response keeps the original operation ID pending. A reset changes the workspace epoch, invalidating old cursors and protecting old pending work for review. The previous full bootstrap/export APIs remain compatible with older installations and explicit export.

Sales, orders, products, stock, customers, payments, transactions and expenses display 50 rows per page. Filters apply before paging; totals, reports and due calculations use the complete dataset. Existing visible-app polling runs every 20 seconds; closed devices synchronize when reopened. Enabling password-encrypted Offline mode is still required for disconnected use.


## Startup and account transitions

The public root page serves the same data-free app shell directly, with deferred scripts fetched in parallel and no framework hydration dependency. Installed service workers reopen the cached public shell immediately while every business API remains network-authenticated. Precache installation starts after a successful data load, outside the login critical path.

Small workspaces fit inside the initial bounded packed response. Large initial replicas resume keyset downloads across at most four collections concurrently; no totals are calculated from partial history. Read-only pages and change feeds do not rerun seed/import initialization.

After server credential/session verification, a complete encrypted per-account device replica can be displayed immediately, with Syncing shown while current changes reconcile. Cached records may reflect the last sync until that completes; epoch/version/stock checks still protect writes. Logout revokes the server session before reporting success and clears displayed/in-memory business records. It retains the encrypted per-account replica for the next verified login, alongside existing encrypted Offline vaults. Cache access still requires a new successful server login/session check; no password or session token is persisted by this optimization. Pending financial work must still reconcile before logout. Late refresh responses cannot repopulate a logged-out account.


## Audit

SQLite triggers append actual before/after values in the same transaction as each business row change. The verified server account and operation ID are set inside that transaction; request payloads cannot impersonate actors. Rolled-back writes produce no audit event; idempotent replay produces no duplicate. Business reset retains the journal. UPDATE/DELETE of audit events is denied by database triggers.

Admin: Settings → Audit & cloud backups → View audit trail. Pages are bounded by row count and a byte target; optional API filters are `actor` and `entity`. This covers the hosted D1 app, including legacy hosted write routes. Earlier historical actions cannot be attributed retroactively; migration/import actions are marked `system`. It does not add actor attribution to the separate Python application.

## Headers and monitoring

The Worker and `_headers` declare CSP, anti-framing, nosniff, referrer, permissions headers and HTTPS HSTS. Live verification on 23 October 2026 confirmed these on the main page, APIs and health endpoint. The current Sites hosting layer serves static files directly and does not honor the declared `assets.run_worker_first` / `_headers` settings: `/offline-store.js` is still missing those headers. Static-file header enforcement remains a hosting limitation; the local built Worker passes its header tests. Inline scripts/styles are currently allowed for framework and print compatibility. CSP does not use `unsafe-eval`. Cloudflare's [static header contract](https://developers.cloudflare.com/workers/static-assets/headers/) explains why both `_headers` and Worker response handling are needed.

`GET /healthz` performs a database probe without returning business data. Admin → Monitoring & backups shows request counts/server errors and recent backups. The protected API also exposes hourly route/status counts and cumulative/max latency for the last 24 hours; stored aggregates expire after 30 days. No bodies, credentials, customer IDs or query strings enter those aggregates. Monitoring writes run after the response and cannot turn a committed save into a failed save.

For external monitoring, probe `/healthz` expecting HTTP 200 and `{"status":"ok"}`. External scheduled probes and alerts are deliberately disabled at the user’s request. Provider infrastructure monitoring/retention is separate from the app's metrics.

## Private cloud backups

Admin → Create verified cloud backup captures business tables, durable operation IDs, selected migration/settings metadata and historical audit records in one D1 read batch, writes a private R2 object, reads it back, and verifies SHA-256 before listing it as ready. Download repeats the checksum check. Authentication sessions, rate-limit entries, account password records and environment secrets are excluded. The catalog stores hash, size, creator and counts in D1; it is also useful to keep the hash with a separately downloaded copy.

Manual backups remain available. An owner-only MCP writer supports a linked daily cloud task at 03:00 Asia/Dhaka, with a shared atomic daily lease, safe replay, failed-attempt backoff and expired-lease recovery. See `BACKUP_AUTOMATION.md` for the access and readback contract. The Admin panel displays the registered schedule and recent daily job results. A saved task alone does not prove a backup ran. Backups are not automatically pruned and currently have a 32 MiB limit; monitor their age and storage use. This is not an off-provider copy. R2 objects have no public application route; downloads require Admin authentication. General accounts cannot view audit records or create/list/download cloud backups.

## Restore drill

Use the verified cloud download and its SHA-256 from the operations API:

```sh
node scripts/restore-drill.mjs /private/path/backup.json SHA256 /private/path/drill-report.json
```

The script creates a fresh temporary SQLite database with all D1 schema migrations, verifies the file checksum, restores stock credits before sales and other stock debits, restores business data and historical audit, compares every restored business row and durable operation ID, and verifies cash, bank, customer dues, company payable and stock. It refuses a populated destination and deletes its temporary database afterward. If a historical backup already contains negative stock, the drill explicitly preserves it and reports the affected product IDs. Only in that new empty database are the two INSERT stock guards suspended and recreated with their exact original definitions in the same transaction; normal sale/adjustment validation remains enabled. No live balances are corrected automatically. The report contains counts, hashes and aggregate balances; store it privately.

This proves private R2 download → isolated local SQLite/D1-compatible restoration. It is not a provider-side D1 point-in-time recovery drill, account-loss test or regional failover exercise. Provider retention/PITR settings are not exposed by the current hosting controls and have not been verified. There is deliberately no live destructive restore endpoint; an actual disaster recovery requires a reviewed empty D1 destination, current migrations and a fresh backup/hash verification before switching traffic.

## Validation fixture

A 5,000-sale fixture measured a 5,797,009-byte legacy snapshot, 84 bounded initial sync responses with a maximum of 93,831 bytes, a 127-byte idle delta and a 321-byte one-payment delta. These are fixture measurements, not a guarantee for every dataset. Tests cover page races, tombstones, epoch changes, lost responses, audit rollback/replay, immutable history, private backup roundtrip, checksum corruption and restored financial/report equality. Run `node --test tests/*.test.mjs`, TypeScript/lint and `python3 tests/built_login.py` against a fresh built Worker for the HTTP contract.

## Large notes and maintenance actions

The 128 KiB sync/audit budget is a page target. A single already-saved record
that exceeds it is sent alone, without truncation or a 413. Ordinary pages keep
the byte target and all pages keep their row limits. Initial, packed and delta
feeds use the same rule; whole-write request limits still apply and are checked
before the client appends a financial command to the outbox. A successful
command whose subsequent delta fetch fails remains pending reconciliation with
its original operation ID, even for a 4xx delta error. Earlier rejected sync-page
413 entries are safely retried.

Sync Codes is an online maintenance request outside the financial outbox. It
flushes pending financial work first, supplies the workspace epoch, and refreshes
the replica cursor before the next save. Legacy unsupported Sync Codes entries
are removed from device queues; unrelated financial actions retain their IDs.
