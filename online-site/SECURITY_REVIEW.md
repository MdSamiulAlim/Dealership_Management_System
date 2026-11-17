# Dependency security review — 17 November 2026 (Asia/Dhaka)

Fresh npm audits of the installed, locked dependency tree report **zero findings**
for both production and the complete development/build tree. Before this update,
production had one moderate package finding and the whole tree had eight moderate
package findings from two advisory chains. Package counts do not establish that
this application has been exploited.

## Compatible updates

| Package | Before → after | Purpose |
| --- | --- | --- |
| Next.js | 16.4.2 → 16.4.6 | Patched cache/root-param disclosure advisory |
| eslint-config-next | 16.4.2 → 16.4.6 | Keep the Next lint configuration aligned |
| typescript-eslint and its parser/plugin/utils chain | 8.59.3 → 8.73.0 | Upstream-compatible patched glob dependency |
| minimatch under the TypeScript lint chain | 10.2.5 → 11.0.9 | Patched pattern amplification advisory |

The TypeScript ESLint update itself declares `minimatch ^11.0.1`. This is its
supported dependency range, rather than a forced major override. Other users of
unaffected minimatch 3.1.5 remain unchanged. Node 24.13.0, ESLint 9.39.4 and
TypeScript 5.9.3 meet the updated packages' engine/peer requirements. The dependency
tree check has no problems. Existing unrelated overrides are retained; no
`--force`, framework major upgrade, audit downgrade or advisory suppression was used.

## Exposure assessment

- [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h)
  affects Next 16.3.0 through 16.4.4 and is patched from 16.4.5. It requires a
  particular combination of `use cache`, `unstable_cache()` and root params.
  The app source has no such cache directives/calls, and hosting uses the compiled
  Vinext Worker. This reduces the observed exposure; it is not a proof of general
  non-exploitability. The patch is applied regardless.
- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  affects minimatch 7 through versions before 11.0.1. The affected installed path
  was the development lint/parser chain. Business APIs do not feed request values
  into glob expansion, and the deployed site does not run an ESLint/Vite dev
  server. Processing untrusted source/glob patterns remains a development concern;
  its compatible upstream update is now installed.

## Evidence and validation

The dated reports in `security/audit-2026-11-17-*-before.json` and
`security/audit-2026-11-17-*-after.json` retain production/full audit results.
`npm audit --omit=dev --json` and `npm audit --json` both report total 0 after
installation from the updated lockfile. Strict lint uses `npm run lint --
--max-warnings=0`; the shared cross-file product lookup remains in place.

The full test/build, TypeScript, browser and built-Worker HTTP/security results
are retained with this release's verification evidence. They exercise disposable
records, not the live dealership database. No password, role policy, product
catalog/schema or historical invoice migration is part of this update.

Older dated audit JSON files remain as historical evidence. Their former findings
and package versions describe those dates, not the current installed tree. A
clean audit is a point-in-time advisory check, not a penetration test or proof
that an application has no possible vulnerabilities.
