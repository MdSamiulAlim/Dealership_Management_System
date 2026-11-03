# Arafat Traders — dedicated Flutter mobile app

Material Design 3 mobile UI in Dart/Flutter. No WebView, JavaScript shell or embedded web login. Android activity is only the standard Flutter engine entry point. The existing web/Python applications remain separate clients.

## Requirements and development

Verified toolchain: Flutter 3.47.8 (Dart 3.13.7), Android SDK 36, JDK 17, Gradle wrapper 9.3.1. Minimum Android 7.0 / API 24. Install additional SDK platforms requested by plugins using the official SDK manager. Run commands inside this directory:

```sh
flutter pub get
flutter analyze
flutter test
flutter run
```

The default HTTPS API is the existing Arafat Traders hosted service. To use a separate test service:

```sh
flutter run --dart-define=API_ORIGIN=https://your-test-service.example
```

Version 3.0.3 uses the current canonical Site origin, `https://akij-dealership-sami.subscription-cellosc.chatgpt.site`. The former origin redirects there. API requests still reject redirects rather than forwarding login credentials to another host.

Use your existing app username/password. Passwords are never embedded in the app or persisted as plaintext. Server cookies live in Android secure storage. Each account's encrypted replica/outbox is separate. Verified server sessions are required for normal online login; explicit password unlock allows offline work. Logout revokes the server session for that device. Lock retains encrypted pending work.

## Migrate from the previous APK

1. Open the old app, connect to the internet and finish Sync on **every device**. Confirm pending work is zero.
2. Export an encrypted device backup before updating, particularly if any device has unsynced work. Keep its password.
3. Install the new APK **over** the previous version. Do not uninstall or clear app data first. Package ID and signing certificate match the previous APK.
4. Sign in online with the existing account. Server records load automatically. Unsynced WebView storage does not automatically become Flutter storage.
5. If needed, use **Settings & backup → Import encrypted backup** to select the previous app's `arafat-encrypted-v2` JSON. Import preserves operation IDs and supports safe reconciliation. Existing native pending work must finish Sync/export before importing. Wrong passwords leave current data intact.

Offline device records are encrypted with AES-256-GCM using a random device key in secure storage. Password backup/unlock uses PBKDF2-SHA256, 250,000 iterations in a background isolate. A stable operation ID and exact wire payload persist **before** each send. Lost responses retain pending status and replay the same ID. Server-side validation, transaction audit and stock conflict checks remain authoritative. Separate disconnected devices can still compete for the same stock: rejected conflicts remain visible in the pending-work screen for review.

## Screens

Overview (7/15/30 day sales), sales/multiple products/discount/partial payment, invoice view/edit/return/cancel, native Bengali/English invoice PDF/print/share/download, products by category, stock/edit current bags/adjustments, customers/edit details, customer due statements/collections, company orders, Cash/Bank transfers, expenses, reports/CSV, settings, encrypted backup import/export, admin audit and cloud backup access. Only Admin can reset accounts; reset keeps the product list and rates. The logo in the header opens account switching/logout/lock. All quantity inputs use whole bags.

## Release signing

```sh
python3 tool/build_release.py
```

This reads `../private-signing/signing.json` (`alias`, `password`) and `release-keystore.p12`. That folder is deliberately excluded from source ZIPs/version control. Restore the owner's original key securely before signing updates; **do not create a replacement key**. Alternatively provide `ARAFAT_KEYSTORE`, `ARAFAT_SIGNING_PASSWORD`, `ARAFAT_SIGNING_ALIAS` and run `flutter build apk --release --split-per-abi` directly. `FLUTTER_BIN` can select an installed SDK. No signing secrets are placed in Gradle files.

Application ID `com.samiul.akijdealership`; version `3.0.3+9`; ABI version offsets are disabled to preserve normal update numbering. Release APKs are in `build/app/outputs/flutter-apk/`. Install the ARM64 APK on modern phones; ARMv7 is supplied for older supported devices; x86_64 is for emulators/compatible hardware.

After a successful release build, run `python3 tool/verify_release.py` with `ANDROID_HOME` pointing to the SDK and `JAVA_HOME` to JDK 17. It checks the previous release's certificate, increasing version code, ABI/package identity, archive integrity, and 16 KB ZIP/64-bit ELF alignment before copying signed artifacts and checksums into `../releases/`.

`mobile/android/` is Flutter's required platform runner. It contains no dealership UI. The retired root `android/` was the previous Java/WebView client. iOS runner source is included for future builds; iOS needs macOS/Xcode, Apple signing and device testing and is not validated on this Linux machine.

## Verification

`flutter analyze` and `flutter test` cover financial rounding, transfer pairing, stock guards, date validation, returns/refunds by date, customer ID grouping, durable retries/response loss, session revocation, account restrictions, encryption/password failures, old WebCrypto backup import, 5,000-row pagination, native PDFs and all menus/forms at phone sizes in both languages. Widget tests do not replace physical-device tests for printing, file picking, Android Keystore or manufacturer-specific app lifecycle behavior.
