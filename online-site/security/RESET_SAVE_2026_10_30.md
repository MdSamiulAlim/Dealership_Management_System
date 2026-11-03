# Web Reset/Save safety — 30 October 2026

The encrypted Offline vault used write/sync locks during reset, but the online-only durable outbox used different locks. A concurrent online Save could become pending while reset was in flight, then disappear from the active queue. Reset also did not check durable online pending work hidden behind another tab's stale view or the current Offline vault.

The web client now reserves Save/bootstrap and Reset ordering before their first asynchronous step. Reset has a synchronous guard, acquires both sync locks before both write locks, checks current and durable online queues, and rechecks session/account access before adopting the reset result. Accepted earlier pending work blocks reset. New Saves, duplicate resets and account changes are rejected while reset is active; background flush waits. The same-instance fallback now uses real promise mutexes when Web Locks are unavailable. Backup restore/Offline enable use the same ordering boundary.

Reset guards remain active through encrypted storage persistence and are released on success or failure. Online replica cache is refreshed after reset. The UI shows reset progress, disables repeated Reset/Sync controls and translates guard messages in Bengali/English. Updated asset URLs and the service-worker fingerprint deliver the new client after reload.

Regression tests use disposable databases/storage, real Web Locks and fallback locks. They exercise online/Offline reset request races, prior Save ordering, durable pending work from another context, storage-commit gating, restart/reload persistence, duplicate reset rejection and failure recovery. Existing server epoch/atomicity/role rules remain authoritative; stale operations on other devices remain conflicts for review.

No production reset or business-data write is part of verification. Existing database migrations, credentials, product catalog and financial calculations are unchanged. Deployment evidence is recorded outside the source checkout under `releases/web-reset-fix-2026-10-30/`.
