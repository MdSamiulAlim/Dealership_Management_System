# Verification — 24 October 2026

Site: https://akij-dealership-sami.tangylark256.chatgpt.site
Saved version: 50. Source: `023587fd1730cc01a7bd97b4b253e58fb5365692`.

All eight reported bugs have code fixes and regression coverage. The full
change description is `online-site/BUGFIX_2026_10_24.md`.

- 18 Node test modules passed. After the final size guard, the 11 outbox
  scenarios and translation tests passed again.
- 18 Python/WSGI tests passed, including seven bodyless DELETE endpoints with
  empty CONTENT_LENGTH and continued linked-customer protection.
- Lint: zero errors, zero warnings. TypeScript and production build passed.
- Built Worker HTTP checks passed: large Unicode notes through packed, initial
  and delta sync; custom invoice edits; login/logout and revocation; 40
  concurrent wrong passwords; CSRF/role protection; validation, stock limits,
  parent-history protection, balanced transfers, replay and PDFs.
- Real Chrome tests passed against isolated SQLite/HTTP fixture data: custom
  invoice search opens the correct UUID; invoice number editing persists;
  zero-price return included and cancellation without return excluded; draft
  manual Share visible; clipboard permission denial fallback; 390px mobile
  copy area fits; wrong AES-GCM restore password shows a clear Bengali message
  and leaves device records untouched. Zero browser exceptions were recorded.

The 128 KiB sync budget is a page target: a larger accepted record travels on
one page. The 1 MiB whole-write limit remains and is checked before queueing.
Existing financial operation IDs are preserved during reconciliation; only
unsupported maintenance queue entries are removed.

The Python source correction is in the parent app.py; the Sites deployment
updates the hosted Worker. No live business reset or financial write was used
for testing. Existing live data and accounts were retained. APK generation
remains deferred until the user asks. External alerts remain disabled.

Browser evidence is `data/verification/eight-fixes-browser.json`. HTTP artifacts
are in `/tmp/arafat-eight-fixes-http/1` for this session.

Native Sites confirmed version 50 deployed successfully on 24 October 2026,
with environment revision 3 and the existing public audience retained.
