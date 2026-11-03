# Backup setup verification — 23 October 2026

Live Site: https://akij-dealership-sami.tangylark256.chatgpt.site
Version 49, source `fbe7074be467297f36547146f52313a5363b6bd9`.

External alerts and uptime-monitoring tasks are disabled at the user’s request.

The linked cloud task “Arafat Traders daily cloud backup” is saved and enabled,
03:00 Asia/Dhaka daily, starting 24 October 2026. Its native ID is
`Automation_13d3ea813ce48191ba6f0bd34a150c6c`. Native `get_site` confirms the
link, enabled state, timezone and schedule.

The owner-only Site backup connection was provisioned and Plugin Management
confirmed it is already installed. Its new tools are not exposed in this chat.
A cloud task’s authenticated invocation has therefore NOT been exercised here;
the first unattended run remains unverified. A fresh chat/context with this
installed connection can call `run_daily_backup` and `get_backup_status` to
verify that path, without waiting for the scheduled occurrence. No credentials
are stored in the task prompt or source.

The SAME daily backup writer was exercised immediately through the existing
Admin session and API against live D1/private R2, then read back. Today’s job
succeeded. Retrying returned the same backup ID, without another daily backup.
The downloaded object matched its SHA-256; no business records were changed.
The isolated verification session was logged out afterward. Other devices’
sessions remain intact. App Admin status confirms the registered schedule and
external_alerts=false. This is direct Admin/API verification, not a claim that
the unattended OAuth invocation has run.

Backup ID: `bf37fff2-cb48-4747-9af1-76271eeef765`

SHA-256: `ba58353824f465d2a7dab7b1c7cb356bb4d24139cd2abda8ef0190e887bdfb76`

Size: 27074 bytes. Backup and detailed evidence are in private
`data/backups/` with directory permissions 0700 and files 0600.

Validation: all 18 test modules passed; new daily-job tests cover 40 concurrent
requests, replay, upload failure/backoff, expired-lease recovery, initialization
markers and caller authorization. Lint passed with zero errors/warnings,
TypeScript passed, build passed, and the fresh built Worker passed HTTP checks,
including general-role denial and Admin daily replay. Live anonymous and
forged-identity MCP requests were rejected by Sites with HTTP 401.

Dependency recheck: production audit zero; complete audit still eight high
package findings through one braces advisory. Registry latest is 3.0.3 and the
primary GitHub advisory still lists no patched release. This remains unresolved;
no forced downgrade or audit suppression was applied. See
`online-site/SECURITY_REVIEW.md` for exposure and raw audit evidence.

The actual new daily backup also passed the isolated restore drill: every
business row, durable operation ID, historical audit and financial balance
matched; the live DB was untouched. Two pre-existing negative-stock products
were preserved and reported, without changing live stock. This verifies R2 to
isolated local recovery, not cloud D1 PITR.
