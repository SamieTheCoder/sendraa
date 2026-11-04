# Sendraa credential and account reference

Last verified: 3 November 2026. Paths are relative to the repository root unless noted otherwise.

This is the starting point for the owner and future agents. It records credential locations and public identifiers. Private keys, passwords, session tokens, and recovery codes remain in their protected source files or provider stores; do not paste them into committed Markdown, logs, screenshots, or chat.

## Local credential files

| File / store | Contents | Usage |
| --- | --- | --- |
| `services/api/.env` | API database connection, Better Auth encryption/session secret, Cloudflare OAuth client credentials and Tunnel token, passkey association settings | Loaded by the local API. Gitignored. Preserve `BETTER_AUTH_SECRET`: changing it can make encrypted provider credentials unreadable. |
| `services/api/.env.example` | Environment variable names and documentation, without working secrets | Template for a new server. Configure real production values in Dokploy secrets/environment. |
| `apps/mobile/.env` | `EXPO_PUBLIC_API_URL=https://api-dev.sendraa.tech`, `GOOGLE_SERVICES_JSON=./google-services.json` | Local development app config. Gitignored. Only public values may use the `EXPO_PUBLIC_` prefix. |
| `apps/mobile/google-services.json` | Firebase Android **client** configuration for `sendraa-mail` | Included in the Android build. It is not the FCM server private key. Gitignored locally. Use an EAS file environment variable named `GOOGLE_SERVICES_JSON` when configuring cloud builds. |
| `apps/mobile/sendraa-fcm-service-account.json` | FCM service-account private key | Uploaded to EAS push credentials. Gitignored, file mode `0600`. Never put it in app config, assets, or the app bundle. |
| EAS → iOS credentials | APNs push private key | Managed in EAS. No local `.p8` copy was downloaded in this setup. |
| EAS → Android credentials | Android build signing keystore | Managed in EAS; distinct from the generated local debug keystore. |
| `apps/mobile/android/app/debug.keystore` | Generated Android debug signing key | Local development builds only. Generated directory is gitignored. Never use this shared debug certificate to authorize production passkeys. |
| macOS Keychain / Apple login session | Apple sign-in used by EAS | User completed Apple login locally. Do not export it into the repo. |
| Firebase CLI login store | Google CLI login/refresh credential | Use `firebase login:list` to inspect identities and `firebase login` to reconnect. Do not dump the login store. |
| Local API Postgres | Encrypted workspace Gmail/OAuth credentials and per-tenant Worker secrets | Admin configures these through Sendraa. They are not the Firebase/APNs credentials. Access only as needed without logging values. |

## Expo / EAS

- Owner: `scientific_samie`
- Project: `@scientific_samie/sendraa`
- Project ID: `b355ffc4-a9b9-4517-8910-1496ae115432`
- Configuration: `apps/mobile/eas.json`
- Development builds: local. Production builds: EAS.
- Credential commands, run from `apps/mobile`:

```sh
npx eas-cli@latest credentials --platform ios
npx eas-cli@latest credentials --platform android
```

For Android push, select **Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1)**. Do not upload the Firebase client `google-services.json` here. Do not assign the FCM account to Play Store submissions; it only has push permissions.

## Apple / iOS push

- Apple ID supplied by the owner: `samieisworking@gmail.com`
- Team: `PT8JN7TFSB` — Md Samie Sohrab
- Bundle ID: `com.scientific-samie.sendraa`
- APNs key ID: `4DNMWALG7K`
- State: created by the owner and assigned to this app in EAS. The APNs key supports sandbox/development and production delivery.
- Passwords and two-factor codes are entered locally by the owner, never recorded here.

## Firebase / Android push

- Google CLI account used for setup: `samie@trackyfy.in.net`
- Firebase display name: **Sendraa**
- Project ID: `sendraa-mail`
- Project number / FCM sender ID: `928169231146`
- Android package: `com.scientificsamie.sendraa`
- Firebase app ID: `1:928169231146:android:194ef1b8d88bd65f9f9453`
- Service account: `expo-push@sendraa-mail.iam.gserviceaccount.com`
- Granted delivery role: `roles/firebasecloudmessaging.admin`
- State: FCM V1 service-account key uploaded and assigned in EAS to the Android package. IAM and FCM APIs enabled. No billing upgrade was made.
- Key creation was blocked by `constraints/iam.disableServiceAccountKeyCreation`. With owner approval, a project-only exception was applied temporarily, the key was created, and enforcement was restored to `true`. The existing key remains usable; a future rotation may require a new approved exception. Other projects and organization policy were unchanged.

Read-only inventory:

```sh
firebase projects:list
firebase apps:list --project sendraa-mail
```

Recover the Android client configuration (not a private key), from the repository root:

```sh
firebase apps:sdkconfig ANDROID 1:928169231146:android:194ef1b8d88bd65f9f9453 \
  --project sendraa-mail --out apps/mobile/google-services.json
```

If the private FCM JSON is lost, first check EAS credentials. Google does not allow downloading an existing private key again. If rotation is needed, create a replacement, assign it in EAS, verify delivery, then retire the old key; do not delete a working key first.

## Passkey domain and certificates

- Development API / relying party: `api-dev.sendraa.tech`
- Apple application identifier: `PT8JN7TFSB.com.scientific-samie.sendraa`
- Android local debug SHA-256 (currently authorized by the development API):
  `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`
- EAS Android signing SHA-256 observed in the credential manager (not automatically added to the development API):
  `3A:12:7C:7F:68:E4:0C:65:B3:A7:A7:97:93:22:CE:C5:D6:3A:07:35:65:2F:AB:23:76:57:49:95:EB:03:7C:94`
- Play-distributed builds must use Google's **app-signing certificate** when configuring the production association; it may differ from the EAS/upload certificate.
- Public association endpoints:
  - `https://api-dev.sendraa.tech/.well-known/apple-app-site-association`
  - `https://api-dev.sendraa.tech/.well-known/assetlinks.json`
- Do not change the relying-party ID as a branding fix: existing passkeys remain bound to their original domain.

## Operational checks

- Reload the development app after JavaScript changes.
- In Sendraa: **Settings → This device → Notifications → Enable notifications**.
- A native build containing Firebase configuration is required for Android; Expo Go cannot test remote push here.
- Registering a device and configuring provider keys are separate steps. Real delivery, background notification taps, and Copy code must still be tested on a physical phone.
- Ordinary mail has no notification category. Verification-code notifications use `mail_otp` with a `COPY_OTP` action; Android rejects categories with zero actions.

See [notification setup and acceptance checks](notifications-and-invites.md), [passkey configuration](passkeys-and-branding.md), and [deployment locations](deployment.md).
