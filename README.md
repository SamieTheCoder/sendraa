# Sendraa

Professional email on your own domain, with mail stored in your own Cloudflare account. Expo SDK 58 for iOS and Android; a Hono/Better Auth control plane; a small Cloudflare Email Worker backed by D1 and R2.

## Run locally

```sh
pnpm install
pnpm --filter @sendraa/api db:up
pnpm --filter @sendraa/api migrate
pnpm dev
```

Copy `services/api/.env.example` to `services/api/.env` and configure it first. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to the same HTTPS origin as `BETTER_AUTH_URL`; Cloudflare OAuth must return to that host. Existing accounts open their existing workspace. New Cloudflare users create a workspace and connect a domain.

## Sign-in and account security

Cloudflare is the first sign-in/sign-up option. After domain provisioning, owners can set a password, verify an external recovery address and register a passkey on a supported build. Owners may sign in with their Cloudflare account email or their initial `admin@domain` alias. Team members use their invited email. Shared mailboxes are not sign-in identities.

See [account security setup](docs/account-security.md) for Gmail SMTP, native passkeys and release requirements. Privacy Policy and Terms are available without signing in, in the app and at `/legal/privacy` and `/legal/terms` on the API.

## Deploy the mail Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FSamieTheCoder%2Fsendraa%2Ftree%2Fmain%2Fworkers%2Fsendraa-mail)

This official button deploys the **mail Worker**, not the mobile application or Postgres control plane, and does not sign you into Sendraa. Normal users should connect their domain in the app; Sendraa provisions its Worker, database, storage, routing and mailbox together. The button is for developers managing a standalone deployment; follow [the Worker setup](workers/sendraa-mail/README.md). It uses the published `main` branch, so local changes must be pushed before the button includes them.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm --filter @sendraa/mobile exec tsc --noEmit
pnpm --filter @sendraa/api test:security
```

`server/` is the legacy SMTP prototype; active API work belongs in `services/api/`.
