# Arafat Traders — Flutter 3.0.2 (build 8)

Reset now holds the same exclusive lock as Save, Sync and Restore through the reset request, data reload and durable commit. Existing pending work blocks reset. A new Save during reset is rejected with a clear Bengali/English message while the editor retains its input. Reset progress appears in Settings; duplicate reset attempts are blocked. The guard is released after success or failure, and session/account access is checked again before replacing local records.

## Files and installation

Use `Arafat-Traders-Flutter-v3.0.2-arm64.apk` for most current Android phones, `-armv7.apk` for older ARM phones, or `-x86_64.apk` for compatible hardware/emulators. Android 7.0 (API 24) or newer is required. `Arafat-Traders-Flutter-Source-v3.0.2.zip` contains the matching source, assets, fixtures and build instructions; private keys, live data and caches are excluded.

Finish Sync and export an encrypted backup before updating. Install over the existing app without uninstalling or clearing data. Package ID remains `com.samiul.akijdealership`; build 8 replaces build 7 using the original release certificate. No database format migration is introduced by this fix.

## Verification

The release verification JSON records hashes, package/version/ABI identity, signature and Android 16 KB alignment checks. The source verification JSON records clean-extraction checks and correspondence to the APK's source hash. Evidence is under `flutter-v3.0.2-build-evidence/`. Physical-device installation, manufacturer-specific lifecycle behavior and printing have not been tested for this release.
