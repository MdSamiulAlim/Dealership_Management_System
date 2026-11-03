# Daily private cloud backup

This Site exposes an owner-only MCP service at `/mcp`. In-app passwords and
sessions are not accepted by the service. Sites supplies the verified caller
email; `SITES_OPERATIONS_OWNER_EMAIL` restricts invocation to the Site owner.
The public business app retains its own Samiul/Arafat login.

`run_daily_backup` exports existing business tables, durable operation IDs,
initialization/settings markers and audit history to private R2. It reads the
stored object back and verifies SHA-256 before recording success. Daily slots
change at 03:00 Asia/Dhaka. An atomic D1 lease prevents concurrent daily jobs;
completed calls are safe to retry, failed jobs back off five minutes, and an
expired fifteen-minute lease can be reclaimed. If a process dies after storing
a verified catalog entry, the next attempt verifies and reuses that object.

Connect using the Site's provisioned MCP plugin. The linked daily cloud task
must call `run_daily_backup`, then `get_backup_status` and verify the daily job
is `succeeded`. A non-successful or missing result is not a completed backup.
Never put passwords, tokens or backup contents into the task prompt/output.
Source access alone does not authorize this service. After native Sites saves
the task, `record_backup_schedule` records its exact ID for the Admin UI; that
record itself does not create or enable scheduling. If the cloud task is later
paused/deleted, its native state takes precedence over this registration.

External alerts are deliberately disabled at the user's request. This task
performs backups only; it is not an uptime monitor or an alert channel.
Failures are visible in Admin → Audit & cloud backups. No daily backup success
is inferred merely from a saved schedule.

The current backup limit is 32 MiB. Objects are not automatically pruned; this
is private same-provider storage, not an off-provider copy or verified D1 PITR.
Restore uses `scripts/restore-drill.mjs` against a fresh isolated destination;
there is no live destructive restore tool. Passwords, sessions, service owner
configuration and schedule registrations are excluded from backups. Recovery
must configure runtime secrets and scheduling separately.

Admin can manually exercise/retry the same daily writer using
`POST /api/admin/backups/daily` (Run daily backup button). The Admin-only
`POST /api/admin/backup-schedule` records a native saved schedule ID for status;
it does not create a task. These endpoints require the existing app session,
origin/JSON checks and Admin authorization; general users are denied.
