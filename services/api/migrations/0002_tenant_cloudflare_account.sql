-- The Cloudflare account a workspace's mail runs in (ARCHITECTURE.md, Model A).
-- Null only for development workspaces created without Cloudflare.
alter table tenant
  add column cloudflare_account_id   text check (cloudflare_account_id ~ '^[0-9a-f]{32}$'),
  add column cloudflare_account_name text,
  -- The admin whose Cloudflare grant provisions and upgrades this workspace.
  add column cloudflare_user_id      text references "user"(id) on delete set null;

-- One workspace per Cloudflare account: the Worker, D1 and R2 names are fixed.
create unique index tenant_cloudflare_account_idx on tenant(cloudflare_account_id) where cloudflare_account_id is not null;
