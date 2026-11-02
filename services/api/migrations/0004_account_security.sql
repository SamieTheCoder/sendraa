create table account_security (
  user_id text primary key references "user"(id) on delete cascade,
  recovery_email citext,
  recovery_verified_at timestamptz,
  pending_email citext,
  verification_hash text,
  verification_expires_at timestamptz,
  verification_attempts integer not null default 0,
  last_sent_at timestamptz
);

-- Separate from credential email: only the initial, privately owned admin mailbox
-- can be an alias. Shared/team mailboxes never become sign-in identities.
create table login_alias (
  address citext primary key,
  user_id text not null references "user"(id) on delete cascade,
  mailbox_id uuid not null unique references mailbox(id) on delete cascade
);
insert into login_alias(address, user_id, mailbox_id)
select m.address, t.created_by, m.id from mailbox m
join tenant t on t.id = m.tenant_id
join domain d on d.id = m.domain_id
join tenant_member tm on tm.tenant_id = t.id and tm.user_id = t.created_by
where m.address = 'admin@' || d.name and not m.shared and t.created_by is not null
on conflict do nothing;
