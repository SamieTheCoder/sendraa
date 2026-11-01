# Sendraa Architecture

Professional email for startups on their own domain. Users sign in with Cloudflare,
and Sendraa provisions mail infrastructure **inside the user's own Cloudflare account**.
Inbound mail is free and unlimited. Sending offers two paths. The platform stays a
thin control plane, so per-tenant hosting cost is effectively zero.

---

## 1. Product

| | Mailflare | Sendraa |
|---|---|---|
| Model | Self-hosted, user deploys it | Managed platform, one-tap provisioning |
| Login | Own account system | Sign in with Cloudflare (OIDC) |
| Setup | Deploy a Worker, run `/setup`, create token manually | One consent screen |
| Inbound | Free | Free |
| Sending | Workers Paid required | Cloudflare Paid **or** user's Gmail |
| Clients | Web | iOS, Android, web |

The wedge is onboarding friction, not feature count.

---

## 2. Verified platform constraints

These are researched facts, not assumptions. They dictate the design.

| Constraint | Consequence |
|---|---|
| Cloudflare OAuth is public, all plans, full OIDC | One consent screen = login + delegated access |
| Authorization Code only; no device/client-credentials grant | Backend-mediated flow, no PKCE in the app binary |
| Promoting an OAuth client to public is **permanent** | Platform domain must be final before verification |
| Public client needs TXT domain verification, polled ≤ 2 days | Own the domain before launch |
| Account admins can disable OAuth app access org-wide | Onboarding must detect and explain "no account selectable" |
| Email Routing inbound: **unlimited and free**, both plans | Receiving costs nothing, ever |
| Email Sending outbound: **unavailable on Workers Free** | Sending is the natural paywall |
| Sends to *verified destination addresses* are free on any plan | Free tier can still email the user's own addresses |
| Routing rules target a Worker in the **same account** | Worker must live in the tenant's account |
| 200 routing rules/domain · 200 destination addresses/account | Irrelevant under Model A: one catch-all rule, mailboxes in D1 |
| Workers Free CPU: ~10 ms per invocation | `email()` handler must stay trivial; parse lazily |
| Oracle blocks outbound **port 25**, egress rules cannot override | No self-hosted MTA; all outbound over :443 or :587 |
| Oracle outbound **587 and 465 confirmed open** (tested) | Gmail SMTP and any relay are viable |
| Google has no app-password API; creation is manual by design | User pastes it; never automate creation |
| `gmail.send` is a restricted scope (CASA audit, annual) | Gmail OAuth deferred to a later phase |
| Free Gmail cannot DKIM-sign a custom domain | Gmail path fails DMARC alignment; keep tenants at `p=none` |
| APNs/FCM credentials are bound to a bundle ID | ntfy cannot push to the Sendraa app; Expo Push required |

### Resolved decisions

| Decision | Choice | Rationale |
|---|---|---|
| Inbound model | **Model A** — Worker in tenant account | $0 marginal cost; we never run a public MX |
| Mail access | Proxied through platform API | Stable client contract; backend swappable |
| Admin auth | Cloudflare OIDC | Admin owns the CF account and domain |
| Member auth | Email + password / magic link | Staff have no Cloudflare accounts |
| First mailbox | `admin@theirdomain.com`, auto-created | Immediate working inbox after provisioning |
| Worker scope | Ingest + thin JSON API only | Free-tier CPU is ~10 ms; no rendering |
| User push | Expo Push → APNs/FCM | Own bundle ID |
| Ops alerts | Self-hosted ntfy | Already deployed |

---

## 3. System architecture

```
┌─ CLIENT ───────────────────────────────────────────────────────────┐
│   Expo app (iOS / Android)              Web (marketing + webmail)  │
└────────────────────────────┬───────────────────────────────────────┘
                             │ HTTPS, Sendraa session JWT
┌─ CONTROL PLANE (Oracle box, Dokploy) ──┴───────────────────────────┐
│  api           OIDC login, sessions, tenants, mailbox CRUD         │
│  provisioner   creates D1 + R2 + Worker + routing in tenant acct   │
│  verifier      polls DNS, flips domains to verified                │
│  dispatcher    outbound send via relay adapters                    │
│  parser        parses oversized messages the Worker deferred       │
│  fleet         tracks deployed Worker version, rolls upgrades      │
│    └── Postgres: tenants, cf_accounts, tokens, domains, versions   │
│        (control-plane metadata only — no mail bodies)              │
└────────────────────────────┬───────────────────────────────────────┘
                             │ Cloudflare REST API + tenant OAuth token
┌─ TENANT'S OWN CLOUDFLARE ACCOUNT (one per customer, free) ─────────┐
│  Email Routing   MX + rules → Worker                               │
│  Worker          sendraa-mail: email() ingest + authenticated API  │
│  D1              mail metadata, threads, folders, flags            │
│  R2              raw MIME + attachments + images                   │
└────────────────────────────────────────────────────────────────────┘
```

**Mail bodies live in the tenant's account.** The control plane stores only metadata
and credentials. This is both the privacy story and the reason hosting cost is flat.

---

## 4. Monorepo layout

```
sendraa/
  apps/
    mobile/                 Expo 58 + Expo Router (current src/ moves here)
    web/                    marketing + webmail
  services/
    api/                    Hono control plane
    provisioner/            Cloudflare resource orchestration
    verifier/               DNS polling cron
    dispatcher/             outbound queue
    parser/                 deferred MIME parsing
    fleet/                  Worker version rollout
  workers/
    sendraa-mail/           the Worker deployed into tenant accounts
  packages/
    db/                     control-plane schema + migrations
    tenant-db/              D1 schema + typed queries (runs in Worker)
    core/                   threading, MIME, snippets, address parsing
    cloudflare/             typed CF API client (zones, DNS, D1, R2, Workers)
    relay/                  send adapters: cloudflare | gmail | brevo | smtp
    shared/                 zod schemas and types shared with apps
```

---

## 5. Tech stack

| Layer | Choice |
|---|---|
| Mobile | Expo 58, Expo Router, React Native 0.88 |
| Web | Expo Router web target (shared) or Next.js |
| API | Hono + zod |
| Control DB | Postgres (one consolidated instance) |
| Tenant DB | Cloudflare D1 |
| Tenant storage | Cloudflare R2 |
| Tenant compute | Cloudflare Workers |
| MIME | `postal-mime` (Worker), `mailparser` (platform) |
| User push | Expo Push → APNs / FCM (own bundle ID required) |
| Ops alerts | ntfy, self-hosted (already deployed) |
| Metrics | Grafana (already deployed) |
| Deploy | Dokploy compose |
| Build/ship | EAS Build + EAS Submit |

---

## 6. Flows

### F1 — Sign in with Cloudflare

Implemented with **Better Auth** (`genericOAuth`, provider id `cloudflare`) rather than
Auth.js, whose maintainers now point to Better Auth and which has first-class Expo
support. The first Cloudflare sign-in *is* sign-up: it creates the Sendraa user.

```
app: tap "Continue with Cloudflare"
  → authClient.signIn.social({ provider: 'cloudflare' })   (opens system browser)
     GET https://dash.cloudflare.com/oauth2/auth
       ?client_id=…&response_type=code&code_challenge=…(S256)
       &redirect_uri=<BETTER_AUTH_URL>/api/auth/callback/cloudflare
       &scope=openid offline_access user-details.read <resource scopes>&state=…
  → user consents, selects which CF account(s) to expose
  → CF redirects to <BETTER_AUTH_URL>/api/auth/callback/cloudflare
  → api exchanges code at /oauth2/token (client_secret_basic + PKCE verifier)
  → api calls GET /user (scope user-details.read) → email + name; creates user on first sign-in
    (Cloudflare userinfo returns only `sub`, and its consent screen rejects the `email`
     and `profile` scopes, so the OIDC identity scopes are not requested)
  → tokens stored in the Better Auth "account" row, encrypted (encryptOAuthTokens)
  → deep-link back to sendraa:// with the session; stored in the Keychain
```

The app must call the API on **the same host** as `BETTER_AUTH_URL`, because the OAuth
state cookie is set on that host. In development a Cloudflare Tunnel gives the local API
a stable HTTPS name (`api-dev.sendraa.tech` → `localhost:8787`); Cloudflare only
redirects to HTTPS URLs registered on the client.

The OAuth client is registered by `services/api/scripts/create-oauth-client.ts`
(`pnpm oauth:create`). Creating clients needs an API token with **OAuth Client Write**;
no OAuth scope covers that endpoint, so it cannot be done through an OAuth session.
The client stays **private** (only members of the owning account can authorise it)
until the platform domain is final, because going public is permanent.

The refresh token never reaches the device. The platform needs it for background
provisioning, DNS re-checks and fleet upgrades while the user is away.

Failure case to handle explicitly: if no account is selectable, an admin has
disabled OAuth app access. Show that, don't show a generic error.

#### Who signs in how

| Person | First time | After that |
|---|---|---|
| Admin (owns domain + CF account) | Continue with Cloudflare → account created → onboarding | Continue with Cloudflare |
| Team member | Opens invite link → sets a password | Email + password |
| Developer, local only | `ALLOW_DEV_ADMIN_SIGNUP=true` offers a password admin | Email + password |

Nobody can create a password account without an invite outside local development.

### F2 — Connect a domain

```
1. api lists zones via tenant token        GET /zones
2. user picks a zone
3. api writes DNS via tenant token:
     MX    @  route1/2/3.mx.cloudflare.net   (Email Routing)
     TXT   @  "v=spf1 include:_spf.mx.cloudflare.net ~all"
     TXT   _dmarc  "v=DMARC1; p=none; rua=…"
4. enable Email Routing on the zone   POST /zones/:id/email/routing/dns
                                      (needs zone-settings.write, a required scope)
5. verifier polls until records resolve → domains.verified_at
```

Non-Cloudflare DNS is supported by surfacing the same records for manual entry;
the zone-automation step is simply skipped.

### F3 — Provision tenant resources

Idempotent, resumable, and recorded step-by-step so a partial failure can retry.
Implemented in `services/api/src/provision.ts`; the app starts it with
`POST /v1/tenants/:tid/setup { zoneId }` and polls `GET /v1/tenants/:tid/setup`.

| Step | Cloudflare call (all verified against the live API) |
|---|---|
| database | find or `POST /accounts/:id/d1/database` `sendraa-mail` |
| schema | `POST …/d1/database/:db/query` with each `workers/sendraa-mail/schema/*.sql` (IF NOT EXISTS) |
| storage | `GET` or `POST /accounts/:id/r2/buckets` `sendraa-mail`; R2-not-enabled gets a specific message |
| worker | `PUT /accounts/:id/workers/scripts/sendraa-mail` (multipart) with DB, BLOB, TENANT_SECRET, TENANT_ID, PLATFORM_WEBHOOK |
| worker_url | ensure the account workers.dev subdomain, then `POST …/scripts/sendraa-mail/subdomain` |
| routing | `POST /zones/:zone/email/routing/dns` unless already on; stops if foreign MX records exist |
| dmarc | add `_dmarc` TXT `v=DMARC1; p=none` only if none exists |
| catch_all | `PUT /zones/:zone/email/routing/rules/catch_all` → Worker; existing rules keep working |
| mailbox | `admin@domain` in Postgres and in the Worker's D1 |
| check | `GET <worker>/v1/health` with the tenant secret |

The tenant secret is stored AES-256-GCM sealed (`src/crypto.ts`). A new Worker build
changes `artifact.version`, which makes the worker step run again on the next setup:
the seed of F8 fleet upgrades. Setup never deletes or overwrites a tenant's records.

Original sketch:

```
1. CREATE D1 database        sendraa-mail
2. apply D1 schema           (tenant-db migrations)
3. CREATE R2 bucket          sendraa-mail
4. UPLOAD Worker script      sendraa-mail  + bindings:
                               DB   → D1
                               BLOB → R2
                               PLATFORM_WEBHOOK, TENANT_SECRET
5. CREATE Email Routing rule *@domain → Worker
6. record deployed_version in control DB
```

Each step writes a `provision_steps` row, so retries skip completed work.

### F4 — Mailboxes, roles, and member accounts

Two distinct identity paths. Only the admin needs a Cloudflare account.

```
ADMIN   Cloudflare OIDC   owns the CF account + domain
                          connect domain, provision, create/assign
                          mailboxes, manage billing

MEMBER  email + password  no Cloudflare account required
        or magic link     read and send from assigned mailboxes only
```

Provisioning auto-creates the first mailbox, so the tenant has a working inbox
the moment setup finishes:

```
provisioning completes
  → create mailbox admin@theirdomain.com
  → create system folders
  → grant admin owner access
  → inbound is live
```

Adding staff:

```
admin invites alice@example.com
  → control plane issues a single-use invite token
  → member sets a password
  → admin grants access to one or more mailboxes
  → member sees only those mailboxes
```

Mailbox count is bounded by D1 storage, not by Cloudflare. The 200-rule and
200-destination-address limits never come into play because Model A installs a
single catch-all rule and keeps mailboxes as D1 rows.

**Authorisation is enforced in the platform API**, never in the Worker. The Worker
has no concept of users or roles; it answers to a single per-tenant secret and
trusts the caller. Keeping it that dumb is what keeps it inside the CPU budget.

### F4b — Member invites

Invites are sent **through the tenant's own configured sending path**, so the platform
needs no outbound infrastructure and the invite arrives from `admin@theirdomain.com`
rather than a generic no-reply address.

```
admin creates mailbox         alice@theirdomain.com
  → admin supplies alice's personal address (alice@gmail.com)
  → platform mints a single-use invite token
  │
  ├── tenant sending configured
  │     → dispatcher sends via tenant relay (Cloudflare or Gmail)
  │     → From: admin@theirdomain.com
  │
  └── sending NOT configured
        → surface a copyable invite link for the admin to share
          over any channel; no email required

  → alice opens link → sets a password → gains access to her mailbox
```

**Ordering dependency:** emailed invites require F6 to have completed, because they
ride the tenant's relay. The invite-link fallback exists so onboarding is never
blocked on sending setup — an admin can staff the whole team before configuring
outbound at all.

Free-tier note: Cloudflare permits free sends to *verified destination addresses* on
any plan. Adding a member's personal address as a destination makes emailed invites
free without Workers Paid, at the cost of one Cloudflare verification click by the
member. Offered as an option, not the default, because the link fallback is simpler.

#### Invite security

- Token is 32 random bytes, **stored hashed**; the raw value exists only in the link
- Single-use, expires after 7 days, bound to one tenant + mailbox + invited address
- Consuming a token is atomic, so a replayed link cannot create a second account
- Invite sends are rate-limited per tenant and capped by pending count. Without this,
  a malicious tenant could drive spam through their own relay using our templates
- Message body is fixed by the platform; the admin controls recipient and mailbox only
- Responses never reveal whether an address is already registered
- Passwords hashed with Argon2id; tokens and links are never written to logs

### F4c — Worker contract

The Worker is deliberately minimal. Free-tier CPU is roughly 10 ms per invocation
and it is the component most likely to fail under load, so its surface is fixed:

```
email()    1. buffer raw (single-use stream)
           2. PUT raw → R2
           3. INSERT one envelope row → D1
           4. inline-parse only if rawSize < threshold, else needs_parse = true
           5. ctx.waitUntil(signed webhook → platform)

fetch()    thin authenticated JSON over D1 and R2
           list threads · read message · write flags · store outbound copy
```

Explicitly out of scope for the Worker: HTML rendering, templating, UI, search
indexing, attachment transformation, image processing, spam scoring. All of it
belongs in the app or the platform. Dependencies stay at the bare minimum
(`postal-mime` only).

### F5 — Inbound mail

Runs entirely in the tenant's account. The CPU budget is the hard design driver.

```
sender → Cloudflare MX → routing rule → Worker email()

  1. const raw = await new Response(message.raw).arrayBuffer()   // single-use
  2. PUT raw → R2
  3. INSERT envelope row → D1  (from, to, message-id, size, r2 key)
  4. if rawSize < 256 KB → parse inline with postal-mime, fill subject/body/snippet
     else                → mark needs_parse = true
  5. ctx.waitUntil(notify platform webhook → push)
```

Messages above the inline threshold are picked up by the platform `parser`
service, which fetches from R2, parses, and writes back through the Worker API.
This keeps ~95% of mail entirely inside the tenant account while staying under
the 10 ms free-plan CPU limit.

### F6 — Set up sending

Two options, with detection first.

```
         ┌─ probe Cloudflare Email Sending entitlement ─┐
         │  attempt sending-config read with tenant tok │
         └───────────────┬──────────────────────────────┘
                         │
      entitled ──────────┴────────── not entitled (403 / code 10105)
         │                                    │
   Option A: Cloudflare                 offer the choice
   • one tap, we configure              ├── Option A′: upgrade CF to
     SPF/DKIM via held token            │   Workers Paid $5/mo,
   • send over HTTPS :443               │   deep-link dashboard, re-probe
   • 3,000/mo included                  │
                                        └── Option B: Gmail app password
                                            • user enables 2FA, generates
                                              a 16-char app password
                                            • pastes host/user/pass in app
                                            • we send via smtp.gmail.com:587
                                            • 500/day, free
```

**Gmail caveat that must be handled:** Gmail rewrites the `From` header unless the
custom address is a verified "Send mail as" alias in Gmail settings. Left unhandled,
mail goes out as `@gmail.com` and the whole "professional email" promise collapses.

Sendraa can close this loop: because we already receive the tenant's domain mail,
when Gmail sends its confirmation code to `user@theirdomain.com` we capture it on
arrival and surface it in-app for one-tap completion. This turns the single ugliest
step of DIY custom-domain email into a tap, and no competitor using pasted SMTP
credentials can do it.

Free-tier fallback with no sending configured at all: Cloudflare permits sends to
*verified destination addresses* on any plan at no cost, which covers self-notification
and onboarding tests.

### F7 — Outbound mail

```
app → api  (Sendraa session)
  → load tenant sending config
  → relay adapter:
      cloudflare → POST /accounts/{id}/email/sending/send   :443
      gmail      → SMTP smtp.gmail.com:587 STARTTLS
      brevo      → POST api.brevo.com/v3/smtp/email         :443
  → on success: write message + R2 copy into tenant account, add to Sent
  → delivery_log row on the control plane for observability
```

Threading headers (`In-Reply-To`, `References`) are built per RFC 5322 so replies
land in the right conversation in the recipient's client.

### F8 — Fleet upgrade

The structural cost of provisioning into user accounts: every tenant runs *our*
Worker in *their* account, so shipping a fix means redeploying across the fleet.

```
new worker version published
  → fleet enumerates tenants where deployed_version < target
  → canary cohort first, then staged rollout
  → per tenant: refresh OAuth token → upload script → run D1 migrations
  → on failure: mark degraded, alert, keep old version serving
  → revoked token → mark tenant needs_reauth, prompt in-app
```

### F9 — Push notification

```
Worker email() → ctx.waitUntil(POST platform webhook, signed with TENANT_SECRET)
  → api verifies signature → resolves devices → Expo Push → APNs / FCM
```

Webhook payload carries no mail content, only mailbox and message IDs.

**Not ntfy.** APNs credentials are bound to an app's bundle ID, so the ntfy iOS app
pushes via ntfy's own certificate and cannot deliver to the Sendraa bundle. User
notifications require our own APNs key through Expo Push. Self-hosted ntfy is used
for operational alerts to the team instead: provisioning failures, fleet upgrade
errors, ingest anomalies.

### F10 — Billing

Sending is the paywall, because Cloudflare already drew that line.

- **Free** — unlimited inbound, free sends to own verified addresses, or user's Gmail
- **Paid** — managed sending, higher retention, team seats, shared mailboxes

Sell subscriptions on the **web**, not in-app, to avoid Apple's 15–30% IAP cut;
the app reads entitlement. This must be decided before billing is built.

---

## 7. Data model

### Control plane (Postgres) — metadata only

```
users              identity from Cloudflare OIDC
tenants            billing and grouping unit
tenant_members     user ↔ tenant, role
cf_accounts        tenant ↔ CF account id, encrypted refresh token, scopes
domains            zone id, verification state, MX/SPF/DKIM/DMARC flags
provision_steps    idempotent provisioning progress
worker_versions    target version, per-tenant deployed version
sending_config     provider, encrypted credentials, quota, verified_at
delivery_log       outbound attempts, provider ids, bounces
devices            push tokens
audit_log          who changed what
```

### Tenant plane (D1) — the mail itself

```
mailboxes          local_part, display name, type
folders            inbox/sent/drafts/archive/spam/trash/custom
threads            subject_norm, last_message_at, participants
messages           envelope, headers, bodies, r2 keys, needs_parse
message_state      read, starred, snoozed
attachments        filename, content type, r2 key, inline
contacts           derived from traffic
blocklist          per-mailbox sender blocks
rules              store/forward/reject/label
```

---

## 8. Security model

- **Confidential OAuth client.** Client secret and tenant refresh tokens stay
  server-side. The app only ever holds a Sendraa session JWT.
- **Credentials encrypted at rest** with AES-256-GCM (`iv || tag || ciphertext`).
  Relay credentials and refresh tokens are never returned by any API response.
- **Least-privilege scopes.** Request only what provisioning needs, mark the rest
  optional so users can decline and still onboard.
- **Tenant Worker API is authenticated** with a per-tenant shared secret issued at
  provision time; it is not a public endpoint.
- **Webhooks are signed** and carry no message content.
- **No credential automation.** App passwords are pasted by the user, never minted
  by us. We never ask for, store, or transit a user's primary Google password.
- **Mail bodies never transit the control plane** except for the oversized-message
  parse path, where they are processed in memory and not persisted.
- **Revocation respected.** Users can revoke Sendraa from their Cloudflare profile
  at any time; the fleet treats that as `needs_reauth`, not an error to retry.

---

## 9. Feature backlog

Parity target is [Mailflare](https://github.com/hieunc229/mailflare), mapped to the
phase that delivers each capability. Rendering-heavy items live in the app, never
in the Worker.

| Capability | Phase | Lives in |
|---|---|---|
| Connect domain, configure Email Routing | P1 | provisioner |
| Personal mailboxes | P1 | api + D1 |
| Receive mail with attachments | P2 | Worker + R2 |
| Threaded conversation view | P2 | app |
| Send mail, rich formatting | P3 | dispatcher + relay |
| Reply / forward with correct threading headers | P3 | core |
| Signatures | P3 | api |
| Automatic replies | P3 | dispatcher |
| Stars, archive, trash, spam, read state | P3 | api + D1 |
| Custom folders and labels | P3 | api + D1 |
| Search | P3 | D1 FTS, app UI |
| Snoozing | P4 | api + scheduled |
| Shared mailboxes with delegated access | P4 | api, role model |
| Routing rules: store / forward / reject / categorise | P4 | Worker + api |
| Real-time inbox updates | P4 | webhook → push |
| New-message notifications | P3 | Expo Push |
| Contacts | P4 | api + D1 |
| Block senders | P4 | Worker blocklist |
| Import / export mail | P5 | api |
| API keys and webhooks for tenants | P5 | api |
| Audit logs | P4 | control plane |
| Database backups | P5 | fleet |

## 10. Roadmap

| Phase | Deliverable | Proves |
|---|---|---|
| **P0** | Cloudflare OIDC login, private client, list zones | auth works |
| **P1** | Provisioner: D1 + R2 + Worker + routing into a test account | automation works |
| **P2** | Real mail arrives → tenant D1 → Expo inbox | the pipeline works |
| **P3** | Sending: Cloudflare detect + Gmail path, threading, replies | product works |
| **P4** | Fleet upgrades, domain verification, promote client to public | scale works |
| **P5** | EAS submission, billing, managed sending, Gmail OAuth | business works |

P2 is the milestone that de-risks everything. Nothing after it is novel.

### Status (November 2026)

| Piece | State |
|---|---|
| Control-plane API: Better Auth, Google-style IAM, invites, audit | Done, smoke test 38/38 |
| Mobile: sign-in, onboarding, invites, People and access | Done |
| Mobile: Gmail-style mail UI | Done, on sample data |
| Brand: Telegram scheme, Strip mark, app icon (light/dark/tinted), splash | Done |
| Dev HTTPS endpoint via Cloudflare Tunnel `sendraa-dev-api` | Done |
| Cloudflare OAuth client | Script ready; needs a token with OAuth Client Write (the MCP's OAuth session cannot create one) |
| F1 API: `/v1/cloudflare/accounts`, `/v1/cloudflare/zones`, workspace bound to one CF account | Done, smoke test 38/38 |
| F1 app: onboarding picks the CF account and lists its domains | Done, typechecks; needs the OAuth client to run end to end |
| `workers/sendraa-mail` ingest + JSON API | Done, verified locally under `wrangler dev` |
| Provisioner F2/F3: D1, R2, Worker, workers.dev, Email Routing, DMARC, catch-all, admin@ | Built; payloads verified live; full run needs a Cloudflare sign-in |
| P2 mail path: API proxies threads, thread, flags, attachments to the Worker with per-mailbox IAM | Done; `pnpm mail:e2e` 10/10 against `wrangler dev` |
| App inbox on real mail (list, open, read/star/move/snooze/labels written back) | Built, typechecks; sending from a real mailbox says it is not set up yet |
| Sending (F6/F7), push (F9), opening attachments in the app, deleting forever | Next |

---

## 11. Open risks

1. **Oracle box capacity.** Three Supabase stacks already run on one ARM instance
   at 51% memory with 420 zombie processes. Consolidate before adding services.
2. **Outbound port 587/465 confirmed open** on the Oracle box (tested). Port 25
   remains permanently blocked, which rules out a self-hosted MTA but does not
   affect Model A, where all outbound leaves over :443 or :587.
3. **R2 on free accounts may require a card on file.** Bucket creation through the API
   worked on a free account that already had R2 on; a brand-new account is still
   unverified. Setup detects "R2 not enabled" and tells the admin exactly what to do.
4. **Workers Free CPU ceiling.** The 256 KB inline-parse threshold is an estimate
   and needs measuring against real mail.
5. **Platform domain is a one-way door.** The OAuth client URL cannot change after
   verification.
6. **Apple IAP.** Decide web-only billing before building it, not after.
