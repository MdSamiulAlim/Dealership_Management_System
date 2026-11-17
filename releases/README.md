# Current releases

- Web: [Arafat Traders](https://akij-dealership-sami.subscription-cellosc.chatgpt.site), version 56 with exact percentage-discount rounding and patched dependencies.
- Android: `Arafat-Traders-Flutter-v3.0.4-arm64.apk` for most phones; `-armv7.apk` for older ARM phones; `-x86_64.apk` for compatible hardware/emulators.
- Current Flutter source: [mobile/](../mobile/). Build/signing instructions are in [mobile/README.md](../mobile/README.md); generated APKs and source ZIPs are kept outside source control.

Use 3.0.4 (build 10) for the latest percentage-discount fix, record actions and blank new-entry forms. It retains the canonical API address and original signing certificate. Install over the existing app without uninstalling/clearing data. Keep an encrypted backup of pending work. See `Arafat-Traders-Flutter-v3.0.4-README.md` for details.

Current release verification records signing, package/version, source correspondence and alignment checks. The 3.0.3 verification JSON is retained as the certificate/version baseline required by `mobile/tool/verify_release.py`. Older release packages and reports remain available in Git history or the owner's original release folder.
