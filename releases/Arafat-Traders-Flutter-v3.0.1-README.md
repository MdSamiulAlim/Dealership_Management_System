# Arafat Traders — Flutter 3.0.1 (build 7)

This release contains the 2026-10-29 Flutter financial and data-safety fixes:

- Exact invoice payment allocation shared with the web calculation, including large values and rounding ties.
- Stricter offline input validation and safe handling of oversized invoice totals.
- Backup restore protection for pending work, whole-bag return input, and confirmation before leaving edited forms.
- Persistent app locking, removal of open private editors after session expiration, and improved long business names in invoice PDFs.

Server-side dependency updates and the atomic Python login limiter are separate server changes; an APK does not update a Python server installation.

## Install

Use `Arafat-Traders-Flutter-v3.0.1-arm64.apk` for most current Android phones. Use `Arafat-Traders-Flutter-v3.0.1-armv7.apk` for older ARM devices. The x86_64 artifact is for compatible hardware/emulators. Minimum Android version: 7.0 (API 24).

Finish Sync and export an encrypted backup before updating. Install over the existing app; do not uninstall or clear data. Package ID and release certificate must match the previous release; build 7 updates build 6. When moving from the retired WebView app, unsynced browser storage needs the encrypted-backup import described in `mobile/MIGRATION_BN.md`.

## Verification

The adjacent verification JSON records APK hashes, package/version identity, signing certificate and 16 KB alignment checks. Build evidence contains the analyzer, test and build logs. Automated checks cover 118 Flutter tests and static analysis. Physical-device installation, printing and file-picker behavior have not been tested for this release.
