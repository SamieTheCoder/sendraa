# Passkeys and authentication-domain branding

Sendraa uses `api-dev.sendraa.tech` as its development relying-party ID. Its existing iOS passkeys remain bound to that domain; adding icons does not change or migrate those credentials.

The API serves a branded public root page, PNG favicon, a valid PNG-backed ICO, Apple touch icons, and a web manifest. Reset, invitation, and legal pages reference these assets and show the Sendraa logo. Apple Passwords controls its own icon cache and credential grouping; publishing icons does not guarantee an immediate update or merge password/passkey entries. This change covers the API authentication host, not DNS/hosting for the apex `sendraa.tech` domain.

## Android

Android registration and sign-in use the existing `react-native-passkey` native module and the same authenticated Better Auth endpoints as iOS. `ANDROID_SHA256_FINGERPRINTS` is a comma-separated list of signing-certificate SHA-256 digests. The API validates, normalizes, and deduplicates the list before using it for both Digital Asset Links and accepted Android WebAuthn origins. Invalid fingerprints fail startup instead of silently creating invalid origins.

The local development API is configured with the certificate from the generated Android debug keystore. This is a public/shared debug certificate: **never copy it to a production relying party**. Production must list the actual release certificate, including Google Play's app-signing certificate for Play-distributed builds (not merely the upload key).

The Expo config plugin `apps/mobile/plugins/with-passkey-domain.cjs` generates the Android manifest association and resource from `EXPO_PUBLIC_PASSKEY_RP_ID`, falling back to the HTTPS API hostname. It runs during prebuild, so generated native files need no manual changes. The server's RP ID and app association must match.

Rebuild Android locally after pulling the config/plugin change. Test on Android 9 or later with a screen lock and a configured passkey provider, using a development/release build rather than Expo Go. In Account and security, add a passkey, then verify sign-in. No Android device was connected during implementation, so biometric creation/sign-in remain unverified on-device.

The public `/.well-known/assetlinks.json` endpoint must return 200 JSON without authentication or redirects. `/v1/auth/providers` should report `passkey.android: true` only when a relying party and nonempty valid certificate list are configured.

Validation: `pnpm --filter @sendraa/api test:accounts`, `pnpm lint`, and `pnpm typecheck`.

The local Android debug APK built successfully with Firebase client resources and the passkey association. APK signature verification confirmed its certificate matches the live Digital Asset Links entry.
