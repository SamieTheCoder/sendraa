# Where Sendraa runs

## Development locally; production builds on EAS

Development builds run on the developer's computer. From `apps/mobile`:

```bash
pnpm exec expo run:ios --device
pnpm exec expo run:android --device
pnpm start:dev
```

iOS requires Xcode, signing for a physical iPhone, and APNs credentials for remote push. Android requires the Android SDK/JDK and Firebase configuration for remote push. Generated native directories remain generated: change app config/plugins rather than editing them manually.

If a packaged local build using the EAS development profile is needed:

```bash
npx eas-cli@latest build --platform ios --profile development --local
npx eas-cli@latest build --platform android --profile development --local
```

Production binaries are built in EAS:

```bash
pnpm build:production
```

Set the production `EXPO_PUBLIC_API_URL` in EAS before this command. Build output is an iOS/Android binary for distribution through TestFlight/App Store and Google Play (submission is a separate step). EAS Build does not run the API, host the web app, or store tenant mail. EAS Hosting is a separate service and is not required for this deployment plan.

## Platform on Dokploy

Deploy from this monorepo with the repository root as build context:

| Component | Source | Hosting |
|---|---|---|
| API, auth, invitations, provisioning, provider adapters, push dispatcher | `services/api` | Long-running Node service on Dokploy |
| Platform metadata and encrypted provider/OAuth credentials | Postgres | Private database on Dokploy with persistent storage/backups |
| Web client | Web export of `apps/mobile` | Dokploy web service after its production server/container setup is prepared |
| Deferred parser, recurring DNS verifier, staged fleet rollout | Roadmap | Not yet separate deployable services |

The API listens on port 8787 and should have a stable HTTPS hostname, for example `api.sendraa.tech`. The development tunnel at `api-dev.sendraa.tech` is for local work. Provisioning, sending, and the push dispatcher are already part of the API process. There is no need to deploy fictitious `services/parser` or `services/fleet` directories from the target architecture diagram.

Production packaging is **not yet provided**: add Dockerfile/production Compose, environment-based startup without requiring a local `.env`, a migration release step, health checks, private database networking, and backup configuration. Do not deploy `services/api/docker-compose.dev.yml` as production; it contains local credentials and a published development database port.

The API build needs `packages/cloudflare` and the generated Worker artifact from `workers/sendraa-mail`. Keep `BETTER_AUTH_SECRET` stable across deployments: it also protects existing encrypted credentials. Configure `DATABASE_URL`, `BETTER_AUTH_URL`, Cloudflare OAuth credentials, web origins, and optional `EXPO_ACCESS_TOKEN` through Dokploy. Disable development admin signup in production.

When moving from the development tunnel to production, update Cloudflare OAuth redirect configuration and tenant Workers' `PLATFORM_WEBHOOK` URLs. Preserve the existing database/encryption key or explicitly migrate the metadata and connections.

## Mail in each tenant's own Cloudflare account

A workspace owner connects their Cloudflare account. Sendraa's provisioner creates that workspace's `sendraa-mail` Worker, D1 database, R2 bucket, and Email Routing rules **inside that account**. All employees invited into the workspace share that mail infrastructure; access is controlled per mailbox in Sendraa.

The Worker receives mail and exposes an authenticated mail API. D1 stores message data/thread state, and R2 stores raw mail/attachments. The Sendraa API checks user access, proxies reads/changes, and invokes the workspace's sending provider. Mail content can transit the API in memory; it is not persisted in platform Postgres. Your own Sendraa workspace uses your Cloudflare account under this same model.

Notifications flow from the tenant Worker to the Dokploy API, then to Expo Push and APNs/FCM. Firebase holds Android push configuration; it is not where workspaces or mail are stored.

## Direct SMTP on the Dokploy server

This is not deployed or enabled. Dokploy can host an outbound mail service, but a Gmail-backed relay still requires verified Gmail aliases. Direct delivery instead needs outbound TCP 25, a stable public IP with matching PTR/forward DNS, per-domain SPF/DKIM, a durable delivery queue, authenticated submission and sender restrictions. Tenant MX records can remain on Cloudflare for inbound mail.

The current architecture records Oracle hosting with port 25 blocked. Oracle documents a [service-limits exemption request](https://docs.oracle.com/en-us/iaas/releasenotes/changes/f7e95770-9844-43db-916c-6ccbaf2cfe24/); opening a Dokploy port or firewall rule alone does not remove that provider restriction. Confirm the actual hosting provider, port-25 availability and reverse-DNS control before deploying an MTA. Existing-server capacity may avoid another hosting bill, but delivery reputation and operation remain our responsibility.
