# Arafat Traders — Flutter 3.0.3 (build 9)

Includes the Reset/Save safety fix from 3.0.2 and updates the default API address to the canonical URL returned by web publication: `https://akij-dealership-sami.subscription-cellosc.chatgpt.site`.

The former API origin now returns a cross-origin HTTP 307. The native client deliberately refuses redirects, so 3.0.3 connects directly to the new address. Redirect rejection remains enabled to protect credentials. The original application ID, release certificate, account credentials and encrypted storage format remain unchanged.

Finish Sync where possible and export an encrypted backup before updating. Install the new APK over the existing app without uninstalling or clearing data. ARM64 is for most current phones; ARMv7 is for older ARM devices; x86_64 is for compatible hardware/emulators. Minimum Android version: 7.0 (API 24).

The matching source ZIP includes build instructions, tests and assets without private signing material or business data. Signature, version, 16 KB alignment, test results and source hashes are recorded in the adjacent verification JSON/evidence folder. Physical-device installation and printing have not been tested for this release.
