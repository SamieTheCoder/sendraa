-- Control plane: tenants, the mailbox registry used for access control,
-- IAM role bindings, invites and the audit log. Mail itself lives in each
-- tenant's own Cloudflare account and never in these tables.
--
-- Better Auth owns the "user", "session", "account" and "verification"
-- tables; this migration only references "user"(id).

create extension if not exists citext;

create table tenant (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 80),
  created_by  text references "user"(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- A principal belongs to a tenant before it can hold roles in it.
create table tenant_member (
  tenant_id   uuid not null references tenant(id) on delete cascade,
  user_id     text not null references "user"(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_member_user_idx on tenant_member(user_id);

create table domain (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  name         citext not null unique,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index domain_tenant_idx on domain(tenant_id);

-- Registry of mailboxes so they can be IAM resources. Messages stay in D1.
create table mailbox (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  domain_id     uuid not null references domain(id) on delete cascade,
  address       citext not null unique,
  display_name  text not null default '',
  shared        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index mailbox_tenant_idx on mailbox(tenant_id);

-- IAM: a role granted to a user on a resource. Resources are
-- "tenants/<id>" or "tenants/<id>/mailboxes/<id>". A binding on a tenant
-- applies to every mailbox in it, as project bindings do in Google Cloud.
create table iam_binding (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  resource    text not null,
  role        text not null,
  user_id     text not null references "user"(id) on delete cascade,
  created_by  text references "user"(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (resource, role, user_id)
);
create index iam_binding_user_idx on iam_binding(user_id, tenant_id);
create index iam_binding_resource_idx on iam_binding(resource);

create table invite (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  email        citext not null,
  -- The binding created when the invite is accepted.
  resource     text not null,
  role         text not null,
  -- sha256 of the token. The raw token exists only in the invite link.
  token_hash   text not null unique,
  invited_by   text references "user"(id) on delete set null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  text references "user"(id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index invite_tenant_idx on invite(tenant_id, created_at desc);
-- One open invite per address per tenant.
create unique index invite_open_idx on invite(tenant_id, email)
  where accepted_at is null and revoked_at is null;

create table audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid references tenant(id) on delete cascade,
  actor_id    text references "user"(id) on delete set null,
  action      text not null,
  resource    text,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index audit_log_tenant_idx on audit_log(tenant_id, created_at desc);
