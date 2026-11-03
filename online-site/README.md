# AKIJ Feed Dealership — password-protected online app

A mobile and laptop version of the existing Python dealership app, hosted with
Sites and shared server storage in D1. The owner explicitly requested app
credentials without ChatGPT sign-in. The host permits visits without a ChatGPT
account. The public shell contains no business records. An in-app login form
creates a signed HttpOnly session; every business API authenticates it before
touching D1. Legacy Basic credentials remain compatible, with an explicit
logout cookie taking precedence over cached browser/WebView credentials.
Set `APP_LOGIN_USERNAME` and `APP_LOGIN_PASSWORD_RECORD` as hosted
secrets; the verifier uses a salted PBKDF2-SHA256 record. Do not store the actual
password in source or runtime configuration. Keep authentication checks at
the API boundary. This account is Admin/Master. Configure the General
account with `APP_GENERAL_USERNAME` and the secret `APP_GENERAL_PASSWORD_RECORD`.
Both accounts share the dealership records; only the verified Admin may reset
business records and stock. Reset preserves the complete product catalog (active
and archived), product details, prices and alert levels, and zeros opening stock.
Customers and financial ledgers are removed and business settings return to defaults.
Login accounts remain unchanged. Settings shows the current account and role.

Financial safety and authentication:

- Bank Deposit is Cash → Bank; Bank Withdraw is Bank → Cash. One command
  writes a linked debit/credit pair atomically. Deleting either linked entry
  deletes the whole transfer. A guarded runtime backfill pairs matching older
  entries and supplies a missing counterpart without duplicating complete pairs.
- Every app write has a durable operation ID. Online-only devices persist an
  AES-GCM encrypted outbox using an IndexedDB CryptoKey before sending. Ambiguous
  results remain Pending; Sync Now/reload resubmits the exact same command.
  Unconfirmed sent commands cannot be removed. Password-encrypted Offline vaults
  retain their existing outbox. Confirmed online-only journals drop the snapshot.
  Legacy payment/transaction POST routes require X-Operation-ID (or operation_id).
- D1 atomically reserves login attempts before password verification: 10 per IP
  per minute, shared across Workers. Verified Basic API requests release their
  reservation. Signed sessions must also have an active D1 session row; logout
  revokes that session only. Pre-upgrade stateless cookies require a fresh login.
- Daily/monthly sales and receipts use original invoice values. Separate dated
  return/refund journals supply net figures without rewriting prior periods.
  Live stock, customer balances and cash remain net of returns. Customer reports
  group by customer ID even when names match, online and Offline.

Android installation: `/install.html` links to the signed universal APK at
`/downloads/Arafat-Traders-v2.2.0.apk`. The APK contains the site's HTTPS URL,
without embedded login credentials. The Android source and private update key
remain in the parent workspace's `android/` directory; only the signed APK and
its public checksum belong in `public/downloads/`.

The initial data is a consistent snapshot of the local database: 60 products,
including the 42 priced fish/shrimp feeds in Product_price.jpeg, and Cash
Customer. Initialization runs once in an atomic, guarded runtime batch. Later
visits and deployments preserve edits and deletions. Schema-only migrations
are generated in drizzle/; seed records are separate in lib/initial-records.json.

SQL and financial regression expectations were taken from the original Python
app. All account calculations use its stock, due, cash and bank queries. Dates
use Asia/Dhaka. Currency displays preserve fractional taka. The cloud version
supports product edits, stock adjustments, orders, sales, customer payments,
transactions, reports and JSON export. Optional website code sync supports the
confirmed Broiler Grower code; packet-image OCR remains available only in the
original Python app when its OCR dependencies are installed.

Use the hosted URL on both devices. The local Python database is a separate
copy after initial migration and does not automatically synchronize with D1.
Use Export for regular backups. Changes intended for the hosted app belong in
this directory; .openai/hosting.json stores its existing Site identity.

See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the production/development audit
results, exposure assessment, compatible updates and the remaining upstream advisory.

Verification:

```bash
node tests/ledger.test.mjs
node tests/app-access.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

For the actual local HTTP/D1 smoke test, follow the starter's local migration
instructions, start the portable preview on 127.0.0.1:5173, then run:

```bash
python3 tests/built_login.py
```

The built Worker login test uses disposable credentials on loopback. The older
development smoke test additionally needs disposable preview credentials and
`APP_TEST_AUTHORIZATION`; it creates and removes one local test customer. Financial fixtures
use separate disposable SQLite databases and never write to the business DB.

---

# vinext-starter

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)


## Built Worker HTTP regression tests

After building, run `python3 tests/built_login.py --runs 3` to exercise three fresh local Workers and disposable databases, including login/logout, invoices, PDFs, validation and security. Each Worker serves a frozen copy of the built artifact in its own temporary directory. The runner uses Wrangler’s config-to-Miniflare adapter and its pinned Miniflare/workerd dependency directly, including the real D1 and static-asset bindings, without the hot-reloading Wrangler development proxy. The harness never targets the hosted database. Its focused regression tests run with `python3 -m unittest discover -s tests -p test_worker_http.py`.

The intermittent first-page assertion was reproduced during cold starts: the first `GET /` returned a 197-byte plaintext HTTP 500, `Error: Network connection lost.`, with a stack pointing to `miniflare/dist/src/workers/core/entry.worker.js`; subsequent requests returned the complete 67,296-byte HTML page. The development proxy also produced its explicit HTTP 503 "Your worker restarted mid-request" response during the auth probes. A frozen artifact alone did not prevent those proxy restarts; running the same artifact in the fixed Miniflare runtime passed three complete cold-start suites without proxy retries. A 401 from `/api/bootstrap` alone did not verify that the page could render, and the old retry logic recognized a different 503 restart response but missed this proxy response.

Readiness now checks both the protected API and the rendered page within a deadline. The page assertion parses the HTML and requires the real account form, username/password fields, title, complete document, no-store caching and no Basic-auth challenge. Only identified local proxy disconnect/restart responses and transport exceptions have bounded retries for reads or commands carrying their original operation ID. Ordinary writes are never retried. Application 500s, malformed 200 pages and auth failures still fail immediately.

Diagnostics retain response status, selected headers and body under `outputs/http-tests/`, including recovered transient failures. Failed runs also retain Worker output. Use `--artifacts-dir <directory>` to select a CI artifact directory. Cookies and authorization headers are excluded from response metadata; fixtures are disposable. These changes concern local HTTP testing and do not change production authentication.
