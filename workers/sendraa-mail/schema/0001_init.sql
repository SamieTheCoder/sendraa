-- Sendraa tenant mail store. Runs in the customer's own D1 database.
--
-- The control plane owns identity and access. These tables hold only mail,
-- and the Worker trusts its single caller, the Sendraa platform.
-- Timestamps are Unix milliseconds. JSON columns hold Address objects
-- shaped { "name": string, "address": string }.

create table if not exists mailboxes (
  -- Same id as the control-plane mailbox, so both sides agree without a lookup.
  id            text primary key,
  address       text not null unique collate nocase,
  display_name  text not null default '',
  created_at    integer not null
);

-- A conversation. Gmail-style state lives here, not on each message.
create table if not exists threads (
  id               text primary key,
  mailbox_id       text not null references mailboxes(id) on delete cascade,
  subject          text not null default '',
  snippet          text not null default '',
  participants     text not null default '[]',
  location         text not null default 'inbox'
                   check (location in ('inbox', 'archive', 'sent', 'scheduled', 'spam', 'trash')),
  label_ids        text not null default '[]',
  starred          integer not null default 0,
  unread           integer not null default 1,
  important        integer not null default 0,
  snoozed_until    integer,
  message_count    integer not null default 0,
  has_attachments  integer not null default 0,
  last_message_at  integer not null
);
create index if not exists threads_list_idx on threads(mailbox_id, location, last_message_at desc);

create table if not exists messages (
  id             text primary key,
  thread_id      text not null references threads(id) on delete cascade,
  mailbox_id     text not null references mailboxes(id) on delete cascade,
  -- RFC 5322 Message-ID without angle brackets. Used to thread replies.
  message_id     text,
  in_reply_to    text,
  refs           text not null default '[]',
  envelope_from  text not null,
  from_addr      text not null default '{"name":"","address":""}',
  to_addrs       text not null default '[]',
  cc_addrs       text not null default '[]',
  reply_to       text not null default '[]',
  subject        text not null default '',
  snippet        text not null default '',
  text_body      text,
  html_body      text,
  sent_at        integer not null,
  received_at    integer not null,
  raw_key        text not null,
  raw_size       integer not null,
  -- Set when the message was too large to parse inside the CPU budget.
  -- The platform parser fills the body in later.
  needs_parse    integer not null default 0,
  direction      text not null default 'in' check (direction in ('in', 'out'))
);
create index if not exists messages_thread_idx on messages(thread_id, sent_at);
create index if not exists messages_message_id_idx on messages(mailbox_id, message_id);
create index if not exists messages_needs_parse_idx on messages(needs_parse) where needs_parse = 1;

create table if not exists attachments (
  id            text primary key,
  message_id    text not null references messages(id) on delete cascade,
  filename      text not null default '',
  content_type  text not null default 'application/octet-stream',
  size          integer not null,
  content_id    text,
  inline        integer not null default 0,
  r2_key        text not null
);
create index if not exists attachments_message_idx on attachments(message_id);
