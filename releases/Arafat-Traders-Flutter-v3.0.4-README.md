# Arafat Traders — Flutter 3.0.4 (build 10)

Includes the percentage-discount half-up fix: a 50.00 invoice at 0.57% now has a
0.29 discount and a 49.71 total, including offline pending invoices. Also includes
the previously unreleased record Edit/Delete actions, confirmation guards and
blank new-entry forms. Both roles can edit/delete eligible records; only Admin
can reset the workspace. Linked-record and financial-history protections remain.

Install `Arafat-Traders-Flutter-v3.0.4-arm64.apk` on most current phones. Use
`-armv7.apk` for older ARM phones or `-x86_64.apk` for compatible hardware/emulators.
Minimum Android version: 7.0 (API 24).

Install over the existing app without uninstalling or clearing its data. Package
ID and the original release certificate are preserved, and the version code is
increased from 9 to 10. Finish Sync and retain an encrypted backup of pending work
before updating. Existing usernames/passwords and the canonical hosted API address
are unchanged.

Old incorrect invoices are not automatically rewritten because only the discount
amount was stored. Re-enter the intended percentage in an editable invoice and
save to correct one.

The successful 159-test Flutter run and clean analysis cover the unchanged Dart
source and dependency lock used here. APK signatures, package/version, archive
integrity, 16 KB ZIP/ELF alignment and freshly compiled native-code correspondence
are verified for all three architectures. See the adjacent verification JSON and
`flutter-v3.0.4-build-evidence/`. Physical-device installation/printing has not been
tested. Build output included a nonfatal Gradle file-watcher warning; the release
build exited successfully and all artifact checks passed.

Current Flutter source is in `../mobile/`. The older 3.0.3 source ZIP predates these
changes; a new source ZIP was not requested for this release.
