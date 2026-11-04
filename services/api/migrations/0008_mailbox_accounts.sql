-- Only newly created, dedicated work logins are owned by a mailbox lifecycle.
-- Legacy personal accounts must never be deleted when an alias is removed.
alter table mailbox add column account_user_id text unique references "user"(id) on delete set null;

-- One person may receive invitations for several independent work addresses.
drop index invite_open_idx;
create unique index invite_open_idx on invite(tenant_id, email, resource)
  where accepted_at is null and revoked_at is null;
