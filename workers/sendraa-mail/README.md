# Sendraa mail Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FSamieTheCoder%2Fsendraa%2Ftree%2Fmain%2Fworkers%2Fsendraa-mail)

This is the mail storage/API component. The full Sendraa app normally provisions it automatically; do not deploy another copy over a working Sendraa installation.

For a standalone deployment:

1. Deploy with the button. Cloudflare reads `wrangler.jsonc` and provisions D1 (`DB`) and R2 (`BLOB`). Enable R2 in your account if prompted. The button reads the published repository, not local files.
2. Set a randomly generated `TENANT_SECRET` as a Worker secret. Generate it with `openssl rand -hex 32`; never commit it. Set `TENANT_ID` to your intended tenant ID. The JSON API requires the secret.
3. Apply `schema/0001_init.sql` to the new D1 database before using the API (`pnpm exec wrangler d1 migrations apply sendraa-mail --remote` from this directory after checking the target database).
4. Connect the domain’s Cloudflare Email Routing to this Worker. Review existing MX records and routing before making changes.
5. Connect an authorised control plane/client to the Worker URL and initialise the mailbox using the API. The deployment button does not create a Sendraa user, register a workspace in Postgres, or provision mailbox records automatically.

The normal in-app provisioning path handles these steps together. `PLATFORM_WEBHOOK` is optional; leave it empty unless connecting the Worker to a Sendraa control plane that knows its tenant and secret.
