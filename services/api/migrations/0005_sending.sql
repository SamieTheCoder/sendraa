-- Configuration and delivery metadata only. Message content remains in tenant R2/D1.
create table sending_config (
  tenant_id uuid primary key references tenant(id) on delete cascade,
  provider text not null check (provider in ('cloudflare', 'gmail')),
  credentials_enc text,
  gmail_user text,
  allowed_from jsonb not null default '[]',
  verified_at timestamptz not null default now()
);
create table delivery_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  mailbox_id uuid not null references mailbox(id) on delete cascade,
  actor_id text references "user"(id) on delete set null,
  request_key text not null,
  request_hash text not null,
  status text not null check (status in ('sending', 'accepted', 'saved', 'failed', 'unknown')),
  provider text not null,
  message_id text,
  thread_id text,
  result jsonb,
  created_at timestamptz not null default now(),
  unique(mailbox_id, request_key)
);
create index delivery_log_rate_idx on delivery_log(tenant_id, created_at);
alter table mailbox add column synced_at timestamptz;
