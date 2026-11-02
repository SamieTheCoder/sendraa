# Sendraa — Project Context for LLM Agents

Read this first, then `ARCHITECTURE.md` (the full design, ~600 lines), `PRODUCT.md`
(product/brand principles) and `AGENTS.md` (Expo rules). This file is a handoff
snapshot as of **1 November 2026**, last commit `c1a0833`.

> No secrets are in this file. Real values live in git-ignored `.env` files.
> Never print `.env` values back to the user.

---

## 1. What Sendraa is

A multi-tenant "professional email on your own domain" product. An admin signs in
**with Cloudflare**, picks one of their Cloudflare accounts and a zone (domain),
and Sendraa automatically provisions the mail infrastructure **inside the
tenant's own Cloudflare account** on the free tier:

- **D1** database `sendraa-mail` (the mail itself: threads, messages, labels)
- **R2** bucket `sendraa-mail` (raw `.eml` and attachments)
- **Worker** `sendraa-mail` (receives mail via Email Routing, exposes a small JSON API)
- **Email Routing**: enabled, MX/SPF records, catch-all → the Worker, DMARC `p=none` if none exists, `admin@<domain>` mailbox

Sendraa's own control plane (Postgres + Hono API) holds only metadata: users,
tenants, IAM bindings, invites, audit log, provisioning state. Mail content never
leaves the tenant's Cloudflare account; the API proxies reads to the tenant Worker.

The client is an **Expo SDK 58** iOS/Android app with a Gmail-style UI and an
Apple-native feel.

---

## 2. Repo layout (pnpm 12.14.0 monorepo)

```
sendraa/
├── ARCHITECTURE.md        full design: flows F1–F10, data model, security, roadmap, risks
├── PRODUCT.md             product purpose, users, brand commitments, principles
├── AGENTS.md              Expo rules (fetch versioned docs, use `npx expo install`, never edit ios/ android/)
├── CONTEXT.md             this file
├── scripts/dev.sh         `pnpm dev`: Postgres + tunnel + API + Expo in one command (logs in .dev-logs/)
├── apps/mobile/           @sendraa/mobile — Expo 58 app (Expo Router, routes in src/app/)
├── services/api/          @sendraa/api — Hono + Better Auth + Postgres control plane
├── workers/sendraa-mail/  @sendraa/mail-worker — the Worker deployed into each tenant's CF account
├── packages/cloudflare/   @sendraa/cloudflare — typed Cloudflare REST client + OAuth scope lists
├── brand/                 brand board (sendraa-brand.html), fonts, icon renderer (icons/render.mjs)
└── server/                LEGACY first prototype (ingest + policy). Superseded by services/api; do not extend.
```

### apps/mobile (Expo 58, Expo Router)
- Routes `src/app/`: `_layout.tsx`, `index.tsx` (redirect gate), `sign-in.tsx`,
  `onboarding.tsx` (pick CF account → create workspace), `setup.tsx` (pick zone →
  run/poll provisioning), `(tabs)/{mail,search,settings}`, `thread/[id].tsx`,
  `compose.tsx`, `organize.tsx`, `snooze.tsx`, `invite/[token].tsx`, `people/{index,invite}.tsx`.
- `src/lib/auth-client.ts` — Better Auth client (`@better-auth/expo`), `signIn.oauth2({ providerId: 'cloudflare' })`
  with `webBrowserOptions: { preferEphemeralSession: true }`.
- `src/lib/api.ts` — fetch wrapper for `EXPO_PUBLIC_API_URL`. `src/lib/workspace.ts` — current tenant/me state.
- `src/mail/` — `store.ts` (mail state; writes changes back by reference diff in `setState`),
  `live.ts` + `use-live-mail.ts` (real mail when tenant `setupStatus === 'ready'`),
  `sample-data.ts` (used before setup is ready), `types.ts`, `selectors.ts`, `format.ts`.
- `src/components/logo.tsx` (Strip mark), `src/theme/colors.ts` (Telegram palette).
- Env: `apps/mobile/.env` → `EXPO_PUBLIC_API_URL=https://api-dev.sendraa.tech`.
- `expo lint` is **not configured** yet in apps/mobile.

### services/api (Hono 4.13, Better Auth 1.7.14, pg, zod 4)
- `src/auth.ts` — Better Auth with the `genericOAuth` plugin, provider id `cloudflare`.
  Explicit authorize/token/userinfo endpoints (no discovery). `getUserInfo` calls
  Cloudflare `GET /user` for email/name, because Cloudflare's OIDC userinfo only returns `sub`.
  `onAPIError.errorURL = sendraa://sign-in`. `trustedOrigins` includes `http://localhost:${PORT}` in dev.
- `src/cloudflare.ts` — `cloudflareFor(userId)` gets a fresh CF access token through
  `auth.api.getAccessToken` and returns a `CloudflareApi`; `cloudflareError` maps CF errors.
- `src/provision.ts` — the provisioner. Ordered idempotent `STEPS`:
  `database, schema, storage, worker, worker_url, routing, dmarc, catch_all, mailbox, check`.
  Each step stores a `provision_step` row; runs in the background; the app polls
  `GET /v1/tenants/:tid/setup`. `claimSetup` prevents concurrent runs; `SetupError` carries user-facing text.
- `src/crypto.ts` — `seal`/`open` (AES-256-GCM, key from HKDF over `BETTER_AUTH_SECRET`), `newSecret`. Used for the per-tenant Worker secret.
- `src/worker-client.ts` — `workerFetch`, `readyWorker` (signed calls to a tenant Worker).
- `src/iam/{roles,policy}.ts` — Google-Cloud-style IAM (see §5).
- `src/routes/{cloudflare,tenants,mail,invites,hooks}.ts`, `src/invites.ts`, `src/migrate.ts`, `src/env.ts`.
- Migrations: `0001_control_plane.sql`, `0002_tenant_cloudflare_account.sql` (unique `tenant.cloudflare_account_id`), `0003_provisioning.sql`.
- Scripts: `smoke.ts` (38/38 passing), `mail-e2e.ts` (10/10 against `wrangler dev`),
  `create-oauth-client.ts` (registers the CF OAuth client), `db-up.sh` (opens Docker Desktop if needed, waits for healthy Postgres).
- `pnpm start` builds the Worker artifact first (the API uploads it during provisioning).

### workers/sendraa-mail
- `src/index.ts` (email + fetch handlers), `src/ingest.ts` (parse → R2 + D1, then signed POST to API `/v1/hooks/mail`),
  `src/api.ts` (JSON API, routes scoped `/v1/mailboxes/:mid/...`), `src/util.ts`.
- `schema/0001_init.sql` (D1 schema, applied by the provisioner's `schema` step),
  `scripts/build.mjs` → `artifact.js` (bundled script the API uploads), `wrangler.jsonc` (local dev on port 8788).
- Must stay minimal and inside Workers Free limits.

### packages/cloudflare
- `src/api.ts` (typed REST client), `src/oauth.ts`, `src/scopes.ts`:
  - `PROTOCOL_SCOPES = ['openid','offline_access']`
  - `IDENTITY_SCOPES = ['user-details.read']` (do **not** add `email`/`profile` — Cloudflare rejects them)
  - `REQUIRED_SCOPES`: zone.read, zone-settings.read/write, dns.read/write, email-routing-rule.read/write,
    workers-scripts.read/write, d1.read/write, workers-r2.read/write, …
  - `OPTIONAL_SCOPES`: email-sending.read/write, email-routing-address.read/write, workers-r2-bucket-item.read, account-settings.read

---

## 3. Auth model

| Who | How |
|---|---|
| Admin (workspace creator) | **Continue with Cloudflare** (OAuth/OIDC). First sign-in creates the user. |
| Member | Invite link (`/invite/[token]`) → sets a password. |
| Dev only | Password admin sign-up if `ALLOW_DEV_ADMIN_SIGNUP=true`. |

- One workspace (tenant) per Cloudflare account.
- **Cloudflare OAuth client**: "Sendraa (development)", private, id `02894eb3a45f6175a91ec840c8f1d88a`.
  Redirect `https://api-dev.sendraa.tech/api/auth/callback/cloudflare`, `client_secret_basic`,
  grants `authorization_code` + `refresh_token`, `response_types: ['code','id_token']`
  (Cloudflare only allows the `openid` scope when `id_token` is a response type).
  Created with `pnpm oauth:create` (needs `CF_API_TOKEN` with OAuth Client Write + `CF_ACCOUNT_ID`).
  The Cloudflare MCP's OAuth session **cannot** create OAuth clients.
- **Dev HTTPS**: Cloudflare Tunnel `sendraa-dev-api` (id `64d9f05c-e1e5-4e45-80bd-3242e8018f42`),
  `api-dev.sendraa.tech` → `localhost:8787`. The app **must** call the same host as
  `BETTER_AUTH_URL`, otherwise the OAuth state cookie fails.
- Sign-up endpoint is rate-limited (5/min) — running smoke tests back-to-back gives 429.

---

## 4. HTTP API (prefix `/v1`, plus Better Auth at `/api/auth/*`)

```
GET    /me
GET    /roles
GET    /cloudflare/accounts
GET    /cloudflare/zones?accountId=
POST   /tenants                         {name, cloudflareAccountId}
GET    /tenants/:tid
GET    /tenants/:tid/setup              poll provisioning steps
POST   /tenants/:tid/setup              {zoneId}  start/resume provisioning
GET    /tenants/:tid/domains
GET|POST /tenants/:tid/mailboxes
GET    /tenants/:tid/mailboxes/:mid/threads
GET|PATCH /tenants/:tid/mailboxes/:mid/threads/:thid
GET    /tenants/:tid/mailboxes/:mid/attachments/:aid
GET    /tenants/:tid/members, DELETE /tenants/:tid/members/:uid
GET|POST /tenants/:tid/invites, DELETE /tenants/:tid/invites/:iid
GET    /invites/:token, POST /invites/accept
GET    /tenants/:tid/iam, POST /tenants/:tid/iam/bindings, POST /tenants/:tid/iam:test
GET    /tenants/:tid/audit
POST   /hooks/mail                      from tenant Worker; header x-sendraa-signature: t=<ts>,v1=<hmac>
```

Mail endpoints proxy to the tenant Worker and enforce per-mailbox IAM (`mail.read`, `mail.organize`).

---

## 5. IAM (Google Cloud style)

- Users hold **roles**, never raw permissions. Bindings: `(tenant, resource, user, role)`, inherited from ancestors (tenant → mailbox).
- Permissions: `tenant.get/update/delete`, `domains.list/create/delete`, `mailboxes.list/create/update/delete`,
  `mail.read/send/organize`, `members.list/invite/remove`, `iam.policy.get/set`, `sending.configure`, `billing.manage`, `audit.read`.
- Roles: `roles/owner`, `roles/admin`, `roles/mailboxAdmin`, `roles/billingAdmin`, `roles/auditor`, `roles/mailUser`, `roles/mailReader`.
- Rules: you cannot grant management permissions you lack; only owners grant owner; the last owner cannot be removed.
  `iam:test` behaves like `testIamPermissions`.

---

## 6. Provisioning safety rules (do not break)

- Never delete or overwrite tenant DNS/routing records. Stop with a clear error on a foreign MX.
- Add DMARC `p=none` only when no DMARC record exists.
- Catch-all → Sendraa Worker; existing routing rules keep working.
- Every step is idempotent and resumable.
- Worker secret is sealed (AES-256-GCM) before storage in Postgres.

---

## 7. Brand

- Scheme "Telegram": yellow `#F5C400`, ink `#16130E`, tint `#7A5400` (light) / `#F5C400` (dark).
- Mark: "Strip". Wordmark font: League Gothic TTF (wordmark only; UI uses system fonts).
- App icon light/dark/tinted + splash rendered by `brand/icons/render.mjs` (headless Edge via CDP).
- Design: Apple-native, restrained, Gmail-like information density.

---

## 8. Commands

```bash
# Whole stack from repo root (Postgres, tunnel, API, Expo)
EXPO_PORT=6969 pnpm dev

# Or manually
cd services/api && pnpm db:up && pnpm migrate && pnpm start   # API on :8787
cd services/api && pnpm tunnel                                  # api-dev.sendraa.tech
cd apps/mobile && npx expo start --clear --port 6969

# Tests
cd services/api && pnpm smoke                                   # 38/38
cd workers/sendraa-mail && npx wrangler dev                     # :8788, then:
cd services/api && pnpm mail:e2e                                # 10/10

# Checks before declaring done
pnpm typecheck            # all packages (tsc --noEmit)
npx expo install <pkg>    # never pnpm add for Expo deps
```

Env files (git-ignored): `services/api/.env` (see `.env.example`: `DATABASE_URL`, `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, `CLOUDFLARE_CLIENT_ID/SECRET`, `APP_SCHEME`, `ALLOW_DEV_ADMIN_SIGNUP`,
`CLOUDFLARE_TUNNEL_TOKEN`), `apps/mobile/.env` (`EXPO_PUBLIC_API_URL`).

Logs: `.dev-logs/` when started with `pnpm dev`; `/tmp/sendraa-api.log` when an agent starts the API.

---

## 9. Cloudflare environment (dev)

- Account `dc4ac4fa1afc55d149b3d7cbb0b74cee`; zone `sendraa.tech` (`3a5fffcfc357676fc7607cb2e02ffc66`).
- Email Routing on; catch-all currently disabled; rule `supabase-no-reply@` exists — keep it.
- **Do not touch** the existing `mailflare` Worker, its D1, or R2 bucket `mailflare-raw`.
- Already created by probe tests: D1 `sendraa-mail` (`22204512-ab75-4d9f-820e-91bfad584942`), R2 bucket `sendraa-mail`.
- A probe Worker `sendraa-probe` may still exist — delete it.
- workers.dev subdomain: `samsite-in-net`.

---

## 10. Status

Done (committed):
- Mail UI on sample data; Better Auth + IAM API; sign-in, onboarding, invites, People screens.
- Telegram brand, Strip icon, splash.
- Dev tunnel; OAuth client registered; scopes fixed.
- F1 (accounts/zones, workspace ↔ CF account binding).
- F2/F3 provisioner + setup screen + `/hooks/mail` (payloads verified live via MCP).
- P2: real mail through the API, per-mailbox scoping in the Worker, live inbox in the app.
- `pnpm dev`; `db:up` auto-starts Docker Desktop (it tends to quit on its own).

Not yet verified:
- **No successful end-to-end Cloudflare sign-in yet.** Last fix (commit `924698e`) removed the
  `email`/`profile` scopes; the user still has to retry.
- Full provisioning against a real account (routing, DMARC, catch-all live).
- A real inbound email reaching D1 and appearing in the app.

Bugs fixed (don't reintroduce):
| Symptom | Cause / fix |
|---|---|
| `invalid_scope … 'openid'` | OAuth client needs `id_token` in `response_types` |
| `request_forbidden: No CSRF value…` | stale browser cookie → `preferEphemeralSession: true` |
| `Unknown oauth scope "email"` | use `user-details.read` + `GET /user` instead of email/profile |
| Provider silently missing | discovery fetch failed → static endpoints |
| Docker socket error | Docker Desktop quit → `db:up` opens it and waits |
| Render loop in workspace | `resetMe` in `apps/mobile/src/lib/workspace.ts` |
| `Could not validate the database schema` | harmless when Postgres is down |

---

## 11. Next steps (in order)

1. User runs `EXPO_PORT=6969 pnpm dev`, reloads the app, does Continue with Cloudflare →
   create workspace → Email setup → `sendraa.tech`. Check the API log for the callback,
   the `account` row and `provision_step` results; fix failures.
2. Send a test mail to `admin@sendraa.tech`; confirm D1 row + inbox in the app.
3. Security housekeeping: the user must revoke the CF API token used for `oauth:create`
   (it was pasted in chat and also exposed R2 S3 keys) and rotate the Dokploy API key.
4. Delete `sendraa-probe` Worker if present.
5. Features: sending F6/F7 (detect CF Email Sending, else Gmail app password over :587 —
   port 25 is blocked), push F9 (Expo Push triggered from `/v1/hooks/mail`), open attachments
   in-app, delete forever (currently skipped for remote threads), fleet upgrade F8, billing F10.
6. Configure `expo lint` in apps/mobile.
7. Open question for the user: does their phone run Expo Go or a dev build?

---

## 12. Working rules for agents

- Expo changes every SDK: read `apps/mobile/package.json` (`expo ~58`) and fetch
  `https://docs.expo.dev/versions/v58.0.0/` before touching Expo APIs. Don't trust memory.
- `npx expo install` for app deps; pin exact versions elsewhere.
- Never hand-edit `ios/` or `android/` (CNG) — use `app.json` / config plugins.
- Run `pnpm typecheck` (and lint where configured) before claiming done.
- Free-tier only on the tenant side; keep the Worker small.
- Never touch tenant resources Sendraa didn't create.
- Agents can't tap in the iOS simulator — ask the user to perform UI steps and report back.
- Commit only when asked; stage specific files; never commit `.env`.
