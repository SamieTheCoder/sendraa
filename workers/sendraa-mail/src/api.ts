import { safeEqual } from './util';

declare const __WORKER_VERSION__: string;

/**
 * F4c: thin JSON over D1 and R2 for the Sendraa platform.
 *
 * There are no users or roles here. The platform authorises every request
 * before it arrives and proves itself with the per-tenant secret.
 */

const LOCATIONS = ['inbox', 'archive', 'sent', 'scheduled', 'spam', 'trash'] as const;
type Location = (typeof LOCATIONS)[number];

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !(await safeEqual(token, env.TENANT_SECRET))) {
    return json({ error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid credentials.' } }, 401);
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    if (method === 'GET' && path === '/v1/health') return json({ ok: true, version: __WORKER_VERSION__ });

    let m = /^\/v1\/mailboxes\/([\w-]{1,64})$/.exec(path);
    if (m && method === 'PUT') return await putMailbox(env, m[1]!, request);

    m = /^\/v1\/mailboxes\/([\w-]{1,64})\/threads$/.exec(path);
    if (m && method === 'GET') return await listThreads(env, m[1]!, url.searchParams);

    m = /^\/v1\/threads\/([\w-]{1,64})$/.exec(path);
    if (m && method === 'GET') return await getThread(env, m[1]!);
    if (m && method === 'PATCH') return await patchThread(env, m[1]!, request);

    m = /^\/v1\/messages\/([\w-]{1,64})\/raw$/.exec(path);
    if (m && method === 'GET') return await streamObject(env, 'select raw_key as k, \'message/rfc822\' as t from messages where id = ?', m[1]!);

    m = /^\/v1\/attachments\/([\w-]{1,64})$/.exec(path);
    if (m && method === 'GET') return await streamObject(env, 'select r2_key as k, content_type as t from attachments where id = ?', m[1]!);

    return json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: { code: err.code, message: err.message } }, err.status);
    throw err;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 64 * 1024) throw new HttpError(413, 'TOO_LARGE', 'Body too large.');
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'INVALID_JSON', 'Expected a JSON object.');
  return body as Record<string, unknown>;
}

async function putMailbox(env: Env, id: string, request: Request) {
  const body = await readJson(request);
  const address = typeof body.address === 'string' ? body.address.trim().toLowerCase() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.slice(0, 80) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new HttpError(400, 'INVALID_ARGUMENT', 'address must be an email address.');
  await env.DB.prepare(
    `insert into mailboxes (id, address, display_name, created_at) values (?, ?, ?, ?)
     on conflict(id) do update set address = excluded.address, display_name = excluded.display_name`,
  )
    .bind(id, address, displayName, Date.now())
    .run();
  return json({ id, address, displayName });
}

type ThreadRow = {
  id: string;
  mailbox_id: string;
  subject: string;
  snippet: string;
  participants: string;
  location: Location;
  label_ids: string;
  starred: number;
  unread: number;
  important: number;
  snoozed_until: number | null;
  message_count: number;
  has_attachments: number;
  last_message_at: number;
};

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

function threadJson(t: ThreadRow) {
  return {
    id: t.id,
    mailboxId: t.mailbox_id,
    subject: t.subject,
    snippet: t.snippet,
    participants: JSON.parse(t.participants),
    location: t.location,
    labelIds: JSON.parse(t.label_ids),
    starred: t.starred === 1,
    unread: t.unread === 1,
    important: t.important === 1,
    snoozedUntil: iso(t.snoozed_until),
    messageCount: t.message_count,
    hasAttachments: t.has_attachments === 1,
    lastMessageAt: iso(t.last_message_at),
  };
}

/**
 * Query: location (default inbox) | view=starred|snoozed, label, before (ms cursor), limit.
 * Snoozed threads are hidden from their location until they wake.
 */
async function listThreads(env: Env, mailboxId: string, q: URLSearchParams) {
  const now = Date.now();
  const where = ['mailbox_id = ?'];
  const params: (string | number)[] = [mailboxId];

  const view = q.get('view');
  if (view === 'starred') {
    where.push("starred = 1 and location not in ('spam', 'trash')");
  } else if (view === 'snoozed') {
    where.push('snoozed_until > ?');
    params.push(now);
  } else {
    const location = (q.get('location') ?? 'inbox') as Location;
    if (!LOCATIONS.includes(location)) throw new HttpError(400, 'INVALID_ARGUMENT', 'Unknown location.');
    where.push('location = ?', '(snoozed_until is null or snoozed_until <= ?)');
    params.push(location, now);
  }

  const label = q.get('label');
  if (label) {
    where.push('exists (select 1 from json_each(threads.label_ids) where value = ?)');
    params.push(label);
  }
  const before = Number(q.get('before'));
  if (Number.isFinite(before) && before > 0) {
    where.push('last_message_at < ?');
    params.push(before);
  }
  const limit = Math.min(Math.max(Number(q.get('limit')) || 50, 1), 100);

  const { results } = await env.DB.prepare(`select * from threads where ${where.join(' and ')} order by last_message_at desc limit ?`)
    .bind(...params, limit)
    .all<ThreadRow>();
  const threads = results.map(threadJson);
  const last = results.at(-1);
  return json({ threads, nextBefore: results.length === limit && last ? last.last_message_at : null });
}

type MessageRow = {
  id: string;
  message_id: string | null;
  in_reply_to: string | null;
  refs: string;
  from_addr: string;
  to_addrs: string;
  cc_addrs: string;
  reply_to: string;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  sent_at: number;
  needs_parse: number;
  direction: 'in' | 'out';
};

type AttachmentRow = { id: string; message_id: string; filename: string; content_type: string; size: number; content_id: string | null; inline: number };

async function getThread(env: Env, id: string) {
  const [thread, messages, attachments] = await env.DB.batch([
    env.DB.prepare('select * from threads where id = ?').bind(id),
    env.DB.prepare(
      `select id, message_id, in_reply_to, refs, from_addr, to_addrs, cc_addrs, reply_to, subject, text_body, html_body, sent_at, needs_parse, direction
         from messages where thread_id = ? order by sent_at`,
    ).bind(id),
    env.DB.prepare(
      'select a.id, a.message_id, a.filename, a.content_type, a.size, a.content_id, a.inline from attachments a join messages m on m.id = a.message_id where m.thread_id = ?',
    ).bind(id),
  ]);
  const t = (thread?.results as ThreadRow[] | undefined)?.[0];
  if (!t) throw new HttpError(404, 'NOT_FOUND', 'Thread not found.');
  const atts = (attachments?.results ?? []) as AttachmentRow[];
  return json({
    ...threadJson(t),
    messages: ((messages?.results ?? []) as MessageRow[]).map((m) => ({
      id: m.id,
      messageId: m.message_id,
      inReplyTo: m.in_reply_to,
      references: JSON.parse(m.refs),
      from: JSON.parse(m.from_addr),
      to: JSON.parse(m.to_addrs),
      cc: JSON.parse(m.cc_addrs),
      replyTo: JSON.parse(m.reply_to),
      subject: m.subject,
      date: iso(m.sent_at),
      text: m.text_body,
      html: m.html_body,
      needsParse: m.needs_parse === 1,
      direction: m.direction,
      attachments: atts
        .filter((a) => a.message_id === m.id)
        .map((a) => ({ id: a.id, name: a.filename, type: a.content_type, size: a.size, contentId: a.content_id, inline: a.inline === 1 })),
    })),
  });
}

async function patchThread(env: Env, id: string, request: Request) {
  const body = await readJson(request);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if ('location' in body) {
    if (!LOCATIONS.includes(body.location as Location)) throw new HttpError(400, 'INVALID_ARGUMENT', 'Unknown location.');
    sets.push('location = ?');
    params.push(body.location as Location);
  }
  for (const key of ['starred', 'unread', 'important'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') throw new HttpError(400, 'INVALID_ARGUMENT', `${key} must be a boolean.`);
      sets.push(`${key} = ?`);
      params.push(body[key] ? 1 : 0);
    }
  }
  if ('labelIds' in body) {
    const ids = body.labelIds;
    if (!Array.isArray(ids) || ids.length > 50 || !ids.every((x) => typeof x === 'string' && x.length <= 64)) {
      throw new HttpError(400, 'INVALID_ARGUMENT', 'labelIds must be a list of up to 50 ids.');
    }
    sets.push('label_ids = ?');
    params.push(JSON.stringify([...new Set(ids)]));
  }
  if ('snoozedUntil' in body) {
    const v = body.snoozedUntil;
    const ms = v === null ? null : typeof v === 'string' ? Date.parse(v) : Number.NaN;
    if (ms !== null && !Number.isFinite(ms)) throw new HttpError(400, 'INVALID_ARGUMENT', 'snoozedUntil must be an ISO date or null.');
    sets.push('snoozed_until = ?');
    params.push(ms);
  }
  if (!sets.length) throw new HttpError(400, 'INVALID_ARGUMENT', 'Nothing to update.');

  const row = await env.DB.prepare(`update threads set ${sets.join(', ')} where id = ? returning *`)
    .bind(...params, id)
    .first<ThreadRow>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Thread not found.');
  return json(threadJson(row));
}

/** Streams an R2 object without buffering it in the Worker. */
async function streamObject(env: Env, sql: string, id: string) {
  const row = await env.DB.prepare(sql).bind(id).first<{ k: string; t: string }>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  const object = await env.BLOB.get(row.k);
  if (!object) throw new HttpError(404, 'NOT_FOUND', 'Stored object is missing.');
  return new Response(object.body, {
    headers: { 'content-type': row.t, 'content-length': String(object.size), 'cache-control': 'private, max-age=0' },
  });
}
