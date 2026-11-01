-- F2/F3: what Sendraa created in the tenant's Cloudflare account, and how far
-- setup got. Mail itself stays in the tenant's D1 and R2.

alter table tenant
  add column setup_status        text not null default 'not_started'
                                 check (setup_status in ('not_started', 'running', 'ready', 'failed')),
  add column setup_error         text,
  add column d1_database_id      text,
  add column r2_bucket           text,
  add column worker_name         text,
  add column worker_url          text,
  add column worker_version      text,
  -- Shared secret the platform uses to call the Worker and verify its
  -- webhooks. AES-256-GCM, see src/crypto.ts.
  add column worker_secret_enc   text,
  add column provisioned_at      timestamptz;

alter table domain
  add column zone_id               text,
  add column routing_enabled_at    timestamptz;
create unique index domain_zone_idx on domain(zone_id) where zone_id is not null;

-- One row per setup step, so a retry skips finished work and the app can
-- show progress. `detail` keeps what is needed to undo the step.
create table provision_step (
  tenant_id   uuid not null references tenant(id) on delete cascade,
  step        text not null,
  status      text not null check (status in ('running', 'done', 'failed')),
  detail      jsonb not null default '{}',
  error       text,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, step)
);
