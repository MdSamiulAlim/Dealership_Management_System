# Startup performance — 23 October 2026

Live app: https://akij-dealership-sami.tangylark256.chatgpt.site

Published version: 47. Source: `3cf8cf745f9b5dc81996b6814422ae0f43283fc3`.

| Action | Before | Final |
| --- | ---: | ---: |
| Cold open to login screen | 2.29 s | 1.53 s |
| First login, complete initial data | 30.27 s | 4.07 s |
| First logout | 0.56 s | 0.94 s |
| Repeat verified login, cached view | 26.46 s | 2.38 s |
| Repeat logout | 0.69 s | 0.85 s |

Installed public-shell cache reopened the logged-out login screen in 203 ms; the document came from the service worker. This measures the public startup screen, not a completed server-authenticated dashboard load.

Measurements used the same isolated Chrome profile and live connection. First-login runs cleared origin storage; cached repeat login preserved the encrypted per-account replica. These are observed runs, not guaranteed times. Network latency varied: an intermediate cached-login run measured 1.16 s, and an intermediate cold-open run measured 4.70 s. Initial download and device storage still grow with total history.

## Changes

- The root serves the data-free app shell directly; deferred scripts download in parallel without waiting for React hydration. Installed workers show the cached public shell immediately. Business APIs remain uncached and authenticated.
- First login for the current small workspace uses 3 API requests instead of 14. Larger histories use bounded pages and at most 4 concurrent collection downloads.
- Completed setup and snapshot metadata use one read batch, plus one packed-data batch, rather than repeated seed/import writes and sequential metadata reads. Missing setup/settings and legacy sales still initialize correctly.
- After successful server credential/session verification, an encrypted complete per-account cache can display immediately while fresh changes reconcile. Syncing indicates that the cached view may be older than the server. Logout retains this encrypted cache for the next verified login; it clears displayed/in-memory data after revoking the server session.
- Logout does not wait for a background refresh or delete the reusable encrypted replica. A late response cannot repopulate data after logout. Unsynced financial actions still block logout.
- Empty sync polls skip full-history sorting, recalculation and re-encryption. Precache downloads start after the initial data load, outside the login critical path.

## Validation

- Lint: 0 errors / 0 warnings. TypeScript and production build passed.
- All 17 Node test files passed, including stable payment retries, cache/session rejection, logout during refresh, packed-page bounds/concurrency and initialization after reset/legacy sales.
- Built-Worker HTTP checks passed: public shell, login/session revocation, rate limiting, financial validation, protected audit/backup, invoices and PDF downloads.
- Real local-browser checks passed: first/cached login, delayed refresh during logout, Admin/General account switch, mobile/desktop layout and offline reopening/unlock. No browser runtime errors in local or live measurements.
- Live measurements changed only the isolated verification session; no financial records were entered, edited or deleted. No APK was built.

Raw timing files are stored privately in `data/backups/speed-*.json`.
