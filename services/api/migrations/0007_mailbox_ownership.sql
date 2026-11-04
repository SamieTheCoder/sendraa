alter table mailbox add column owner_user_id text references "user"(id) on delete set null;
alter table mailbox add column deleting_at timestamptz;
-- Preserve known personal owners. Never infer ownership from an admin role.
update mailbox m set owner_user_id=a.user_id from login_alias a where a.mailbox_id=m.id and not m.shared;
update mailbox m set owner_user_id=(select i.accepted_by from invite i where i.resource='tenants/'||m.tenant_id||'/mailboxes/'||m.id and i.accepted_by is not null order by i.accepted_at limit 1)
where not m.shared and m.owner_user_id is null;
update mailbox m set owner_user_id=(select min(b.user_id) from iam_binding b where b.resource='tenants/'||m.tenant_id||'/mailboxes/'||m.id and b.role='roles/mailUser' having count(distinct b.user_id)=1)
where not m.shared and m.owner_user_id is null;
insert into login_alias(address,user_id,mailbox_id) select address,owner_user_id,id from mailbox where not shared and owner_user_id is not null on conflict do nothing;
