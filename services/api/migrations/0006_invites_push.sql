alter table sending_config add column default_mailbox_id uuid references mailbox(id) on delete set null;
-- Upgrade existing workspaces to a stable default, preferring their admin address.
update sending_config s set default_mailbox_id = (
  select m.id from mailbox m where m.tenant_id=s.tenant_id
  and (s.provider='cloudflare' or s.allowed_from ? m.address::text)
  order by (split_part(m.address::text,'@',1)='admin') desc,m.created_at,m.id limit 1
);
-- Push stores routing metadata only. No subjects, bodies, or verification codes.
create table push_device (
  id uuid primary key,
  user_id text not null references "user"(id) on delete cascade,
  session_id text not null references session(id) on delete cascade,
  token text not null unique,
  platform text not null check(platform in ('ios','android')),
  preference text not null default 'all' check(preference in ('all','important','none')),
  copy_otp boolean not null default true,
  updated_at timestamptz not null default now()
);
create table push_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  mailbox_id uuid not null references mailbox(id) on delete cascade,
  thread_id text not null,
  message_id text not null,
  created_at timestamptz not null default now(),
  unique(tenant_id,mailbox_id,message_id)
);
create table push_delivery (
  event_id uuid not null references push_event(id) on delete cascade,
  device_id uuid not null references push_device(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','sending','ticket','delivered','failed','skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  ticket_id text,
  error_code text,
  primary key(event_id,device_id)
);
create index push_delivery_pending on push_delivery(status,next_attempt_at);
