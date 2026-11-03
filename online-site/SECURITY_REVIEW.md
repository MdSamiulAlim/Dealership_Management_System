# Dependency security review — 23 October 2026 (Asia/Dhaka)

The production audit initially reported five vulnerable packages: one critical,
two high and two moderate. After compatible updates, `npm audit --omit=dev`
reports **zero** findings. The complete tree went from 30 package findings
(1 critical, 21 high, 7 moderate, 1 low) to **8 high development findings**
from one remaining `braces` advisory chain. Package counts are not counts of
independent vulnerabilities or evidence of an exploited application.

Machine-readable evidence is in `security/audit-production-before.json`,
`security/audit-production-after.json`, `security/audit-all-before.json`, and
`security/audit-all-after.json`.

## Original production findings and exposure

| Package | Before → after | Exposure assessment from app source | Advisory |
| --- | --- | --- | --- |
| next | 16.3.4 → 16.4.2 | The hosted app runs the compiled Vinext Worker, not a Node Next server. No app route imports `next/og`, generates attacker-controlled SVG via ImageResponse, uses `use cache`, or declares Server Actions. The lack of these app-level paths reduces exposure to the corresponding advisories; it is not a general proof of non-exploitability. Update applied regardless. | [Next ImageResponse](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), plus the Next advisories recorded in the before audit |
| sharp | 0.35.4 → 0.35.5 | App receipts use pdf-lib/fontkit; supplied logos are static assets. No business route accepts arbitrary SVG for a Sharp conversion. Sharp is still a declared production dependency, so its librsvg fix is retained. | [librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) |
| source-map-js | 1.2.1 → 1.2.2 | Used by CSS/source-map tooling. No app route accepts user-supplied source maps for parsing. Source maps used during builds come from project dependencies and source. | [Indexed source-map offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| baseline-browser-mapping | 2.10.30 → 2.11.31 | Browser target selection is build configuration, not a business API input. No app endpoint passes request values into this package. | [Invalid-input termination](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) |
| fast-uri | 3.1.7 → 3.1.9 | Transitive URI/schema tooling. App authentication, trusted origins and Android download host checks use native URL parsing; they do not use fast-uri host normalization. | [URI normalization](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) |

This is a source/dependency exposure review and regression verification, not a
production penetration test or a claim that exploitation has occurred.

## Additional compatible updates

React, React DOM and react-server-dom-webpack now match at 19.2.9. The RSC
transport is relevant to the Vinext app, even though npm classifies its direct
package as development. [The Server Functions advisory](https://github.com/advisories/GHSA-wx67-qw84-cm4g)
is therefore addressed, rather than relying only on the production audit.

Vite is 8.3.5, eslint-config-next 16.4.2 and drizzle-kit 0.31.11. Tested,
explicit transitive overrides supply image-size 2.0.4, ws 8.21.0, Undici 7.29.1,
Sharp 0.35.5 under Miniflare, esbuild 0.25.12 under the legacy Drizzle loader,
and esbuild 0.28.2 under Wrangler. Remaining permitted transitive fixes were
applied with `npm audit fix`, without `--force`. No framework major upgrade or
npm-recommended downgrade was used.

## Remaining development advisory

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects braces through 3.0.3; the advisory currently lists no patched release.
The eight npm findings propagate through braces, micromatch, fast-glob,
@next/eslint-plugin-next, eslint-config-next, vite-plugin-dynamic-import,
vite-plugin-commonjs and vinext. They are development/build dependency paths,
not eight independent confirmed application exploits.

The observable imports are the ESLint root-directory glob helper and Vite's
build-time dynamic-import glob handling. Inputs here are repository file/glob
patterns. Business API values are not passed into glob expansion, and the
published app serves a compiled Worker rather than a Vite/ESLint server. The
remaining attack surface is processing untrusted project files or patterns in
the development/build workflow. This dependency is not treated as fixed.

npm's forced fix proposes downgrading eslint-config-next to 14.2.35 and Vinext
to 0.0.15. Those changes are incompatible with this application's framework
baseline. Keep the finding tracked until a patched compatible dependency is
available; do not suppress it or falsely report a clean full-tree audit.

## Verification

- The production audit reports zero findings; the full-tree audit retains the
  eight development findings documented above.
- Local Python: 17 production-route/database tests passed, including balanced
  transfers in both directions, paired deletion, atomic rollback on counterpart
  failure, and the upgrade of an actual old schema without a transfer column.
- Hosted app: all 16 Node test files passed; lint has zero errors/warnings;
  TypeScript passed; upgraded Drizzle generated no schema changes.
- The production build and built-Worker HTTP regression passed, including
  login/logout, 40 concurrent wrong logins (30 limited), balanced transfers,
  idempotent payment retry, stock/validation protections and invoice/PDF output.
- Build/HTTP verification commands: `node <Sites plugin>/scripts/build-site.mjs`
  and `python3 tests/built_login.py --runs 1` (disposable credentials/database).

## Recheck for the remaining eight findings

On 23 October 2026, fresh registry audits again report zero production findings
and eight high package-level development findings. `npm view braces version`
still returns 3.0.3; the primary GitHub advisory still lists patched versions as
None. No package downgrade, audit suppression or unreviewed replacement of the
glob engine is applied. The application never accepts user glob patterns; build
and lint should process trusted repository inputs only. This limits exposure
but does not resolve or remove the advisory. Updated raw audit results replace
the `*-after.json` evidence files. Recheck the upstream advisory before the next
dependency update.
