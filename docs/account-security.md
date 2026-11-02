# Account security setup

## Database and API

Run `pnpm --filter @sendraa/api migrate` before restarting the API. This creates recovery metadata and aliases for existing privately owned admin mailboxes. Better Auth migrations also create its passkey table when `PASSKEY_RP_ID` is enabled. No existing mailbox or Cloudflare infrastructure is deleted.

The current Better Auth 1.7 generic OAuth provider uses `/sign-in/social`. Do not replace it with the older `/sign-in/oauth2` endpoint. OAuth initiation has a 10/minute limit; password attempts 10/minute, account creation 5/minute, recovery requests 3/minute. The app respects `X-Retry-After`/`Retry-After` and never retries sign-in mutations automatically.

By default, requests without a trusted IP share a safe per-path limit. For an API reachable **only** through Cloudflare Tunnel, set `TRUST_CLOUDFLARE_PROXY=true` to use Cloudflare’s overwritten `cf-connecting-ip`. Do not enable this on an origin clients can reach directly with forged headers. Rate limiting remains enabled in development and production.

## Gmail recovery delivery

Set these in the API's private environment, never in `EXPO_PUBLIC_*` variables:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=465` (TLS; port 587 uses required STARTTLS)
- `SMTP_USER`: the sending Gmail/Workspace address
- `SMTP_PASSWORD`: its Google app password, created with 2-Step Verification enabled
- `SMTP_FROM`: optional authorised sender, normally the same address

The transport also supports another SMTP server through those variables. Email delivery providers can be added behind `sendSecurityMail`; this does not expose a public arbitrary-email sending API. Workspace outbound mail remains a separate feature.

Recovery configuration is not offered as working when credentials are absent. Codes expire after 15 minutes, allow five attempts, are hashed with a keyed digest, and can be redeemed once. A new recovery address is not used until verified. Requests are capped at one verification email per account per minute. Password reset uses Better Auth’s expiring single-use tokens and revokes sessions. Reset links place the token in the URL fragment, which is not sent in HTTP requests/logs; the browser removes it from history. SMTP delivery errors must be monitored without logging message bodies or credentials.

Owners can set their first password from a fresh session. Changing a password requires the existing password. Recovery-address changes also require signing in within the last 15 minutes. A recovery address must be outside Sendraa-managed domains.

## Native passkeys

Passkeys use `@better-auth/passkey` on the API and `react-native-passkey` on the device. **Expo Go does not contain the native module.** Cloudflare/password sign-in and recovery screens still work there; passkey actions are hidden.

Before an EAS development/production build:

1. Choose the stable HTTPS API hostname as `PASSKEY_RP_ID` on the server and `EXPO_PUBLIC_PASSKEY_DOMAIN` for the app build. It must match the host serving the association files and the origin in `BETTER_AUTH_URL`.
2. Set `APPLE_APP_ID` to `<Apple team ID>.com.scientific-samie.sendraa` using the actual signing account. The API serves `/.well-known/apple-app-site-association`. `app.config.ts` adds the webcredentials entitlement during generation.
3. Set `ANDROID_PACKAGE` to `com.scientificsamie.sendraa` (or the actual app package), and `ANDROID_SHA256_FINGERPRINTS` to the comma-separated signing certificate SHA-256 fingerprints. The API serves `/.well-known/assetlinks.json` and verifies the corresponding Android origins.
4. Run the API migration with passkeys enabled, restart it, and build with EAS. Verify create, sign-in, cancellation and removal on both physical platforms. Do not invent team IDs or certificate fingerprints.

Only configured platforms receive an enabled passkey capability. Private keys and biometric material never reach Sendraa. Passkey challenges and responses are verified server-side by Better Auth.

## Policy release review

Policy text is shared by native screens and public API pages in `apps/mobile/src/content/legal.ts`. The current contact, `admin@sendraa.tech`, is a provisional project contact. Confirm the operator’s legal identity, address/jurisdiction, contact availability, actual retention periods and hosting providers before public release. These are product-specific draft policies, not a certification of legal compliance. No jurisdiction or company registration was invented.
