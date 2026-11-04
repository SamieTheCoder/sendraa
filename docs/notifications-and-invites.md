# Workspace invitations and push notifications

Credential file locations, provider IDs, and recovery steps: [credentials.md](credentials.md).

## Invite a teammate

1. In **Settings → Sending**, save a working provider and choose the **Default workspace sender**, for example `admin@sendraa.tech`. Existing installations prefer an enabled `admin@` mailbox on migration.
2. Open **People and access → Invite someone**. Enter the person's personal email, select **Create a work address**, enter their name and address, and choose a provisioned domain.
3. Keep **Email the invite** enabled. The API creates the mailbox and mailbox-scoped invite together, activates the mailbox in the tenant Worker, then sends the branded HTML/plain-text invitation from the default sender.
4. The recipient opens the HTTPS invitation link, opens Sendraa, and chooses a password for a separate work account. They sign in with the custom work address. The personal email only receives the invitation and serves as verified recovery; an existing personal Sendraa account does not block creation. They get read-and-send access to that mailbox only.

An existing mailbox can be selected under **Existing access**. Activation or delivery failures leave a shareable invitation link and explicit feedback. An invitation expires after seven days by default and can be accepted once. Creating an address with Gmail delivery does **not** automatically verify a Gmail alias: configure that new address in Gmail's **Send mail as** and enable it in Sending before it sends mail.

Preview: [`brand/emails/invitation-preview.html`](../brand/emails/invitation-preview.html).
Regenerate from `services/api` using `node --import tsx scripts/preview-invitation.ts`.
The preview uses fictitious recipients and never sends email.

## Native push setup

Expo Push delivery is free. EAS cloud build quotas/pricing and Apple Developer membership are separate. Expo Go and the web app cannot test this remote-push implementation.

**Build policy:** development builds run locally; production builds run on EAS. EAS Build produces signed mobile binaries; it does not host the API or tenant mail infrastructure. See [deployment.md](deployment.md).

The app is linked to **@scientific_samie/sendraa**, project ID `b355ffc4-a9b9-4517-8910-1496ae115432`. The `development` EAS profile targets `https://api-dev.sendraa.tech`. Set `EXPO_PUBLIC_API_URL` for preview/production builds to the appropriate deployed API before building those profiles.

From `apps/mobile`:

- iOS bundle: `com.scientific-samie.sendraa`. Build development locally with `pnpm exec expo run:ios --device` (Xcode installed). For a local signed build using the EAS profile, run `npx eas-cli@latest build --platform ios --profile development --local` interactively. Authenticate with the Apple Developer account, select the intended team, register the physical device for internal distribution, and configure the signing and APNs push key when prompted.
- Android package: `com.scientificsamie.sendraa`. Register this Android app in the intended Firebase project. Download its client `google-services.json` and set `expo.android.googleServicesFile` in app.json to its local path, or set the EAS file environment variable `GOOGLE_SERVICES_JSON`. The dynamic app config accepts either.
- Upload the Firebase service-account key to **EAS → Project settings → Credentials → Android → FCM V1**, or use `npx eas-cli@latest credentials --platform android`. This is a different file from `google-services.json`; never include the private service-account key in the app bundle or repository.
- Build Android locally after the Firebase client configuration is present: `pnpm exec expo run:android --device` (Android SDK/JDK installed). Alternatively use `npx eas-cli@latest build --platform android --profile development --local`.
- Install the development build on the registered phone and connect it to Metro (`pnpm exec expo start --dev-client`). Enable **Settings → Notifications → Enable notifications**.

If enhanced Expo push security is enabled, set `EXPO_ACCESS_TOKEN` on the API server. Otherwise it is optional. It is never an `EXPO_PUBLIC_*` variable.

Backend migration: `pnpm --filter @sendraa/api migrate`. The API entry point starts the durable dispatcher automatically. Existing tenant Workers already emit the signed webhook; ensure their `PLATFORM_WEBHOOK` still points at the reachable API `/v1/hooks/mail`.

## Copy code behavior

Expand/long-press a verification-code notification and tap **Copy code**. Sendraa comes to the foreground, checks the signed-in account and current `mail.read` access, fetches the message, copies the code, and confirms success. An expired or signed-out session must be reauthenticated first. Codes are never copied automatically on delivery.

Only a single contextual 4–8 digit code is detected. Ambiguous/alphanumeric/spaced codes and unparsed large messages fall back to opening the email. The action expires 15 minutes after the signed mail event. Neither the code nor message content is persisted in the platform database or included in Expo/APNs/FCM payloads. The clipboard remains until the user or OS replaces/clears it.

All/Important/Off and Copy code preferences are per installation. Important uses the conversation's Important flag; there is no importance classifier yet. Device records are tied to an active auth session. Mailbox permission revocation is checked before delivery and before returning a code.

## Verification

- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @sendraa/api test:sending`
- `pnpm --filter @sendraa/api test:security`
- `pnpm --filter @sendraa/api test:notifications`

The tests use disposable local Postgres records and mocked provider/Expo responses. They send no real email or notifications. Physical-device acceptance remains necessary:

1. Send a real email to a test mailbox with the app backgrounded, then with the app closed. Verify the notification opens the correct conversation/workspace.
2. Receive a real verification email; expand the notification, choose Copy code, then paste into the intended application.
3. Check ordinary mail has no Copy code action and that disabling the action removes it from new notifications.
4. Verify Important/Off, logout, revoked mailbox access, and switching users on the same device.
5. Confirm iOS APNs and Android FCM receipts. A receipt confirms provider acceptance, not on-device display.

The webhook from the tenant Worker remains best-effort if the API is down. Durable replay/reconciliation of those missed events remains future work. Once accepted by the API, notifications are durably queued, temporary mail reads retry, Expo receipts are checked, and metadata expires after seven days. Uncertain send outcomes are not blindly replayed.

## Current credential setup (3 November 2026)

- Firebase project **Sendraa** (`sendraa-mail`, project number `928169231146`) is created. Its Android app is `com.scientificsamie.sendraa`.
- The downloaded client config is `apps/mobile/google-services.json` (gitignored). The ignored mobile `.env` sets `GOOGLE_SERVICES_JSON=./google-services.json` locally; EAS builds should use the `GOOGLE_SERVICES_JSON` file environment variable.
- The dedicated `expo-push@sendraa-mail.iam.gserviceaccount.com` service account has only `roles/firebasecloudmessaging.admin` added for delivery. IAM and FCM APIs are enabled.
- **Android FCM configured:** the dedicated service-account key is assigned in EAS to `com.scientificsamie.sendraa` for FCM V1. The local key is gitignored and owner-readable only. With explicit approval, key creation was temporarily allowed on `sendraa-mail`; after creating the key, the restriction was restored (`enforced: true`). Other projects and the organization policy were unchanged. No billing upgrade was made.
- **iOS APNs configured:** the user created and assigned push key `4DNMWALG7K` for team `PT8JN7TFSB` and bundle `com.scientific-samie.sendraa` through EAS. This key supports development and production push. The phone still needs to register through Settings → Notifications → Enable notifications.
- The 71 invitation/push checks pass with mocked delivery. No real push was sent. Registration, background delivery, and Copy code still require physical-device acceptance after credentials are configured.
- Push registration currently follows the active signed-in account on an installation; it does not deliver for every saved account simultaneously.

Notification setup is now near the top of Settings under **This device**. The **Enable notifications** button is at the top of its screen. The legacy notification-options route redirects here instead of only changing local preferences. Reload the development app to receive this JavaScript change.
