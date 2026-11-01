-- Sendraa core schema
-- Multi-tenant email platform: tenants bring their own domain, mail is received
-- by the self-hosted SMTP ingest and sent via per-tenant HTTPS relay credentials.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create type plan_tier as enum ('free', 'pro', 'business');

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        citext not null unique,
  plan        plan_tier not null default 'free',
  created_at  timestamptz not null default now()
);

-- Platform accounts. Mirrors Supabase auth.users when that is wired up;
-- kept standalone so ingest can run without the auth schema present.
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null unique,
  name        text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create type member_role as enum ('owner', 'admin', 'member');

create table tenant_members (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        member_role not null default 'member',
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Domains
-- ---------------------------------------------------------------------------

-- Inbound becomes usable once MX points at us; outbound once the tenant's
-- relay has verified the domain. They are independent, so track separately.
create table domains (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  domain            citext not null unique,

  -- DNS automation. cf_zone_id is null for tenants not using Cloudflare,
  -- in which case records are surfaced in-app for manual entry.
  dns_provider      text,
  cf_zone_id        text,
  cf_token_ref      text,

  -- Ownership proof, written as a TXT record before we accept mail.
  verify_token      text not null default encode(gen_random_bytes(16), 'hex'),
  verified_at       timestamptz,

  mx_ok             boolean not null default false,
  spf_ok            boolean not null default false,
  dkim_ok           boolean not null default false,
  dmarc_ok          boolean not null default false,
  last_checked_at   timestamptz,

  catch_all_mailbox uuid,
  created_at        timestamptz not null default now()
);

create index domains_tenant_idx on domains(tenant_id);

-- ---------------------------------------------------------------------------
-- Mailboxes
-- ---------------------------------------------------------------------------

create type mailbox_type as enum ('personal', 'shared');

create table mailboxes (
  id            uuid primary key default gen_random_uuid(),
  domain_id     uuid not null references domains(id) on delete cascade,
  local_part    citext not null,
  display_name  text,
  type          mailbox_type not null default 'personal',
  signature_html text,
  auto_reply    jsonb,
  created_at    timestamptz not null default now(),
  unique (domain_id, local_part)
);

create index mailboxes_domain_idx on mailboxes(domain_id);

alter table domains
  add constraint domains_catch_all_fk
  foreign key (catch_all_mailbox) references mailboxes(id) on delete set null;

create type mailbox_role as enum ('owner', 'writer', 'reader');

create table mailbox_access (
  mailbox_id  uuid not null references mailboxes(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        mailbox_role not null default 'owner',
  primary key (mailbox_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Outbound relay credentials
-- ---------------------------------------------------------------------------

-- Each tenant brings their own relay key (Brevo/Resend free tier). This keeps
-- sending free for them and keeps their sending reputation off our IPs, so one
-- abusive tenant cannot blacklist everyone else.
create type relay_provider as enum ('brevo', 'resend', 'postmark', 'smtp');

create table relay_credentials (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  provider       relay_provider not null,
  -- Encrypted at the application layer; never select this into API responses.
  secret_cipher  bytea not null,
  from_domain    citext,
  daily_quota    integer,
  verified_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index relay_credentials_tenant_idx on relay_credentials(tenant_id);

-- ---------------------------------------------------------------------------
-- Threads and messages
-- ---------------------------------------------------------------------------

create table threads (
  id              uuid primary key default gen_random_uuid(),
  mailbox_id      uuid not null references mailboxes(id) on delete cascade,
  subject_norm    text not null default '',
  last_message_at timestamptz not null default now(),
  message_count   integer not null default 0,
  participants    citext[] not null default '{}',
  created_at      timestamptz not null default now()
);

create index threads_mailbox_recent_idx
  on threads(mailbox_id, last_message_at desc);
create index threads_subject_idx on threads(mailbox_id, subject_norm);

create type message_direction as enum ('inbound', 'outbound');

create table messages (
  id              uuid primary key default gen_random_uuid(),
  mailbox_id      uuid not null references mailboxes(id) on delete cascade,
  thread_id       uuid references threads(id) on delete set null,
  direction       message_direction not null,

  -- RFC 5322 identifiers, used for threading and dedupe.
  rfc_message_id  text,
  in_reply_to     text,
  refs            text[] not null default '{}',

  from_addr       citext not null,
  from_name       text,
  to_addrs        jsonb not null default '[]',
  cc_addrs        jsonb not null default '[]',
  bcc_addrs       jsonb not null default '[]',
  reply_to        citext,

  subject         text,
  snippet         text,
  text_body       text,
  html_body       text,

  -- Envelope values from the SMTP conversation. Trustworthy, unlike headers.
  envelope_from   citext,
  envelope_to     citext,
  client_ip       inet,

  spf_result      text,
  dkim_result     text,
  dmarc_result    text,
  spam_score      real,

  size_bytes      integer,
  has_attachments boolean not null default false,
  raw_storage_key text,

  received_at     timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index messages_thread_idx on messages(thread_id, created_at);
create index messages_mailbox_recent_idx on messages(mailbox_id, created_at desc);
create index messages_rfc_id_idx on messages(rfc_message_id);

-- A given mailbox must not store the same message twice; retries and
-- multi-recipient delivery both replay the same Message-ID at us.
create unique index messages_dedupe_idx
  on messages(mailbox_id, rfc_message_id)
  where rfc_message_id is not null;

create index messages_search_idx on messages
  using gin (to_tsvector('simple',
    coalesce(subject,'') || ' ' || coalesce(text_body,'') || ' ' || coalesce(from_addr,'')));

-- ---------------------------------------------------------------------------
-- Per-message user state
-- ---------------------------------------------------------------------------

-- Split from messages so a shared mailbox can carry per-user read/star state.
create table message_state (
  message_id    uuid not null references messages(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  is_read       boolean not null default false,
  is_starred    boolean not null default false,
  snoozed_until timestamptz,
  primary key (message_id, user_id)
);

create index message_state_snooze_idx on message_state(snoozed_until)
  where snoozed_until is not null;

-- ---------------------------------------------------------------------------
-- Folders
-- ---------------------------------------------------------------------------

create type folder_type as enum
  ('inbox', 'sent', 'drafts', 'archive', 'spam', 'trash', 'custom');

create table folders (
  id          uuid primary key default gen_random_uuid(),
  mailbox_id  uuid not null references mailboxes(id) on delete cascade,
  name        text not null,
  type        folder_type not null default 'custom',
  color       text,
  created_at  timestamptz not null default now(),
  unique (mailbox_id, name)
);

create table message_folders (
  message_id uuid not null references messages(id) on delete cascade,
  folder_id  uuid not null references folders(id) on delete cascade,
  primary key (message_id, folder_id)
);

create index message_folders_folder_idx on message_folders(folder_id);

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------

create table attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references messages(id) on delete cascade,
  filename      text,
  content_type  text,
  size_bytes    integer,
  storage_key   text not null,
  content_id    text,
  is_inline     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index attachments_message_idx on attachments(message_id);

-- ---------------------------------------------------------------------------
-- Contacts, blocklist, routing
-- ---------------------------------------------------------------------------

create table contacts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  email        citext not null,
  name         text,
  last_seen_at timestamptz,
  message_count integer not null default 0,
  unique (tenant_id, email)
);

create table blocklist (
  id         uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  pattern    citext not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (mailbox_id, pattern)
);

create type rule_action as enum ('store', 'forward', 'reject', 'drop', 'label');

create table routing_rules (
  id         uuid primary key default gen_random_uuid(),
  domain_id  uuid not null references domains(id) on delete cascade,
  pattern    citext not null,
  action     rule_action not null default 'store',
  target     text,
  priority   integer not null default 100,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create index routing_rules_domain_idx on routing_rules(domain_id, priority);

-- ---------------------------------------------------------------------------
-- Delivery log and audit
-- ---------------------------------------------------------------------------

create type delivery_status as enum
  ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed');

create table delivery_log (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid references messages(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  provider    relay_provider,
  status      delivery_status not null default 'queued',
  provider_id text,
  error       text,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index delivery_log_tenant_idx on delivery_log(tenant_id, created_at desc);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references tenants(id) on delete cascade,
  actor_id   uuid references users(id) on delete set null,
  action     text not null,
  target     text,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_log_tenant_idx on audit_log(tenant_id, created_at desc);

-- Rejected or unroutable inbound, kept for debugging onboarding problems.
create table ingest_failures (
  id            uuid primary key default gen_random_uuid(),
  envelope_from citext,
  envelope_to   citext,
  client_ip     inet,
  reason        text not null,
  raw_excerpt   text,
  created_at    timestamptz not null default now()
);

create index ingest_failures_recent_idx on ingest_failures(created_at desc);
