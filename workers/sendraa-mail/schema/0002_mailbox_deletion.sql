-- Durable cleanup progress: object keys survive removal of message metadata.
create table if not exists mailbox_deletions (mailbox_id text primary key, created_at integer not null);
create table if not exists mailbox_cleanup (mailbox_id text not null, object_key text not null, primary key(mailbox_id, object_key));
