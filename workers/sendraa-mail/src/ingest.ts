import PostalMime, { decodeWords } from 'postal-mime';

import {
  type Addr,
  baseAddress,
  flatAddresses,
  hmacHex,
  log,
  parseAddressHeader,
  parseDate,
  parseReferences,
  snippetFrom,
  stripAngles,
} from './util';

/**
 * Messages at or above this size are stored but not parsed here, so the
 * handler stays inside the Workers Free CPU budget (about 10 ms). The platform
 * parser fills them in later. The value is an estimate to be tuned against
 * real traffic (ARCHITECTURE.md, open risk 4).
 */
const INLINE_PARSE_LIMIT = 256 * 1024;

type Parsed = {
  messageId: string | null;
  inReplyTo: string | null;
  refs: string[];
  from: Addr;
  to: Addr[];
  cc: Addr[];
  replyTo: Addr[];
  subject: string;
  sentAt: number;
  text: string | null;
  html: string | null;
};

type StoredAttachment = { id: string; filename: string; contentType: string; size: number; contentId: string | null; inline: boolean; key: string };

/**
 * F5: buffer → R2 → one D1 batch → webhook. Nothing else happens here.
 */
export async function ingest(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const recipient = baseAddress(message.to);
  const mailbox = await env.DB.prepare('select id from mailboxes where address = ?').bind(recipient).first<{ id: string }>();
  if (!mailbox) {
    // A catch-all rule sends every address here; only real mailboxes accept mail.
    message.setReject('550 5.1.1 No such mailbox');
    log('info', 'rejected unknown recipient', { to: recipient });
    return;
  }

  const headerMessageId = stripAngles(message.headers.get('message-id'));
  if (headerMessageId) {
    const dup = await env.DB.prepare('select id from messages where mailbox_id = ? and message_id = ?').bind(mailbox.id, headerMessageId).first();
    if (dup) {
      log('info', 'duplicate delivery ignored', { mailboxId: mailbox.id });
      return;
    }
  }

  const receivedAt = Date.now();
  const id = crypto.randomUUID();
  const day = new Date(receivedAt);
  const rawKey = `raw/${mailbox.id}/${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${id}.eml`;

  // message.raw is single-use, so it is read exactly once.
  const raw = await new Response(message.raw).arrayBuffer();
  await env.BLOB.put(rawKey, raw, { httpMetadata: { contentType: 'message/rfc822' } });

  const fields = fromHeaders(message, headerMessageId, receivedAt);
  let attachments: StoredAttachment[] = [];
  let needsParse = raw.byteLength >= INLINE_PARSE_LIMIT;

  if (!needsParse) {
    try {
      const email = await PostalMime.parse(raw);
      fields.subject = email.subject ?? fields.subject;
      fields.from = flatAddresses(email.from ? [email.from] : [])[0] ?? fields.from;
      fields.to = flatAddresses(email.to);
      fields.cc = flatAddresses(email.cc);
      fields.replyTo = flatAddresses(email.replyTo);
      fields.text = email.text ?? null;
      fields.html = email.html ?? null;
      attachments = await storeAttachments(env, id, email.attachments);
    } catch (err) {
      // A malformed message is still kept; the platform parser gets another go.
      needsParse = true;
      log('error', 'inline parse failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const snippet = snippetFrom(fields.text ?? undefined, fields.html ?? undefined);

  // Thread by In-Reply-To and References, as RFC 5322 clients do.
  const candidates = [...new Set([fields.inReplyTo, ...[...fields.refs].reverse()].filter((v): v is string => Boolean(v)))].slice(0, 20);
  let thread: { id: string; participants: string } | null = null;
  if (candidates.length) {
    thread = await env.DB.prepare(
      `select t.id, t.participants from messages m join threads t on t.id = m.thread_id
        where m.mailbox_id = ? and m.message_id in (${candidates.map(() => '?').join(',')})
        order by m.sent_at desc limit 1`,
    )
      .bind(mailbox.id, ...candidates)
      .first();
  }

  const threadId = thread?.id ?? crypto.randomUUID();
  const participants = mergeParticipants(thread ? (JSON.parse(thread.participants) as Addr[]) : [], fields.from);
  const hasAttachments = attachments.some((a) => !a.inline) ? 1 : 0;

  const statements: D1PreparedStatement[] = [];
  if (thread) {
    statements.push(
      env.DB.prepare(
        `update threads set snippet = ?, participants = ?, unread = 1,
           message_count = message_count + 1,
           has_attachments = max(has_attachments, ?),
           last_message_at = max(last_message_at, ?),
           location = case when location = 'archive' then 'inbox' else location end
         where id = ?`,
      ).bind(snippet, JSON.stringify(participants), hasAttachments, fields.sentAt, threadId),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `insert into threads (id, mailbox_id, subject, snippet, participants, message_count, has_attachments, last_message_at)
         values (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(threadId, mailbox.id, fields.subject, snippet, JSON.stringify(participants), hasAttachments, fields.sentAt),
    );
  }
  statements.push(
    env.DB.prepare(
      `insert into messages (id, thread_id, mailbox_id, message_id, in_reply_to, refs, envelope_from, from_addr, to_addrs, cc_addrs, reply_to,
         subject, snippet, text_body, html_body, sent_at, received_at, raw_key, raw_size, needs_parse)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      threadId,
      mailbox.id,
      fields.messageId,
      fields.inReplyTo,
      JSON.stringify(fields.refs),
      message.from.toLowerCase(),
      JSON.stringify(fields.from),
      JSON.stringify(fields.to),
      JSON.stringify(fields.cc),
      JSON.stringify(fields.replyTo),
      fields.subject,
      snippet,
      fields.text,
      fields.html,
      fields.sentAt,
      receivedAt,
      rawKey,
      raw.byteLength,
      needsParse ? 1 : 0,
    ),
  );
  for (const a of attachments) {
    statements.push(
      env.DB.prepare(
        'insert into attachments (id, message_id, filename, content_type, size, content_id, inline, r2_key) values (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(a.id, id, a.filename, a.contentType, a.size, a.contentId, a.inline ? 1 : 0, a.key),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (!await env.DB.prepare('select id from mailboxes where id=?').bind(mailbox.id).first()) {
      await env.BLOB.delete([rawKey,...attachments.map((a) => a.key)]);
      message.setReject('550 5.1.1 Mailbox was deleted');
      return;
    }
    throw error;
  }

  log('info', 'stored', { mailboxId: mailbox.id, size: raw.byteLength, needsParse, attachments: attachments.length });

  if (env.PLATFORM_WEBHOOK) {
    ctx.waitUntil(notify(env, { event: 'message.received', mailboxId: mailbox.id, threadId, messageId: id, needsParse }));
  }
}

function fromHeaders(message: ForwardableEmailMessage, messageId: string | null, receivedAt: number): Parsed {
  const h = message.headers;
  return {
    messageId,
    inReplyTo: stripAngles(h.get('in-reply-to')),
    refs: parseReferences(h.get('references')),
    from: parseAddressHeader(h.get('from'))[0] ?? { name: '', address: message.from.toLowerCase() },
    to: parseAddressHeader(h.get('to')),
    cc: parseAddressHeader(h.get('cc')),
    replyTo: parseAddressHeader(h.get('reply-to')),
    subject: decodeWords(h.get('subject') ?? '').trim(),
    sentAt: parseDate(h.get('date'), receivedAt),
    text: null,
    html: null,
  };
}

async function storeAttachments(env: Env, messageId: string, list: Awaited<ReturnType<typeof PostalMime.parse>>['attachments']): Promise<StoredAttachment[]> {
  return Promise.all(
    list.map(async (a) => {
      const id = crypto.randomUUID();
      const key = `att/${messageId}/${id}`;
      const body = typeof a.content === 'string' ? new TextEncoder().encode(a.content) : a.content;
      await env.BLOB.put(key, body, {
        httpMetadata: { contentType: a.mimeType, contentDisposition: a.disposition === 'inline' ? 'inline' : 'attachment' },
      });
      return {
        id,
        filename: a.filename ?? '',
        contentType: a.mimeType,
        size: body.byteLength,
        contentId: stripAngles(a.contentId),
        inline: a.disposition === 'inline' || Boolean(a.related),
        key,
      };
    }),
  );
}

function mergeParticipants(existing: Addr[], from: Addr): Addr[] {
  const rest = existing.filter((p) => p.address !== from.address);
  return [...rest, from].slice(-10);
}

/** F9: signed, content-free notification so the platform can push. */
async function notify(env: Env, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ ...payload, tenantId: env.TENANT_ID });
  const ts = Math.floor(Date.now() / 1000);
  const signature = await hmacHex(env.TENANT_SECRET, `${ts}.${body}`);
  try {
    const res = await fetch(env.PLATFORM_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sendraa-signature': `t=${ts},v1=${signature}` },
      body,
    });
    if (!res.ok) log('error', 'webhook rejected', { status: res.status });
  } catch (err) {
    log('error', 'webhook failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
