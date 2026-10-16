# APJ CRM apps — Android (.apk) and Windows (.exe)

Both apps open **https://crm.apjtech.in**, so every CRM update reaches them without reinstalling.
They are built by GitHub Actions (`.github/workflows/build-apps.yml`) and published on the
repository's **Releases → "APJ CRM apps"** page (`crm-apps` tag).

| File | Use |
|---|---|
| `APJ-CRM-1.0.N.apk` | Android 7+ phones. Allow "Install unknown apps" for the browser / Files app once. |
| `APJ-CRM-Setup-1.0.N.exe` | Windows 10/11 installer (Start menu + desktop shortcut). |
| `APJ-CRM-Portable-1.0.N.exe` | Windows, runs without installing. |
| `SHA256SUMS.txt` | Checksums to confirm the files were not changed. |

## Security built in
**Android**
- App lock: fingerprint / face / phone PIN when opened and after 2 minutes in the background.
- HTTPS only, system certificates only (no user-installed certificates, so no interception); bad certificates are refused.
- Only crm.apjtech.in / api.apjtech.in open in the app — other links open in the phone's browser.
- Login and data are excluded from Google cloud backup and phone-to-phone transfer.
- WebView file/content access off, no debugging in the release build, Safe Browsing on, code shrunk (R8).
- Camera, microphone and location are asked for only when a CRM page needs them, and only given to CRM pages.

**Windows**
- The CRM page is sandboxed: no access to files or programs on the computer (context isolation, sandbox, no Node).
- HTTPS only, certificate errors refused, other websites open in the normal browser.
- Login kept in an encrypted app profile; menu **APJ CRM → Sign out & clear data on this computer** wipes it.
- Hardened Electron (fuses: no run-as-node, no inspector, cookie encryption, app only from its archive), no developer tools.

## Signing (Android)
Add the four secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
(Settings → Secrets and variables → Actions). Until then the APK is signed with a throw-away key and named `…-TEST-KEY.apk`;
after adding the secrets, uninstall the test app once and install the new APK — later updates install over it.
Never commit the keystore — this repository is public.

The Windows .exe is not code-signed (that needs a paid certificate), so Windows SmartScreen shows
"Windows protected your PC" the first time → **More info → Run anyway**.

## Build again
GitHub → Actions → "Build mobile (APK) and Windows (EXE) apps" → **Run workflow** (it also runs on every change under `apps/`).
