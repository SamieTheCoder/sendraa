import { Hono } from 'hono';
import { z } from 'zod';

import { body, requireSession, uuid, type AppEnv } from '../http.js';
import { IamError, authorize, resolveResource } from '../iam/policy.js';
import { mailboxResource, type Permission } from '../iam/roles.js';
import { readyWorker, workerFetch } from '../worker-client.js';

/**
 * Mail, proxied to the tenant's Worker (ARCHITECTURE.md: "Mail access: proxied
 * through platform API"). Access is checked here per mailbox; the Worker
 * scopes every query to the mailbox in the path, so a thread id from another
 * mailbox is simply not found there.
 */
export const mail = new Hono<AppEnv>();
mail.use('*', requireSession);

const WORKER_ID = /^[\w-]{1,64}$/;

async function gate(c: { get: (k: 'session') => { user: { id: string } }; req: { param: (k: string) => string } }, permission: Permission) {
  const tid = uuid.safeParse(c.req.param('tid'));
  const mid = uuid.safeParse(c.req.param('mid'));
  if (!tid.success || !mid.success) throw new IamError(404, 'NOT_FOUND', 'Not found.');
  const resource = await resolveResource(mailboxResource(tid.data, mid.data), tid.data);
  await authorize(c.get('session').user.id, permission, resource);
  return { worker: await readyWorker(tid.data), mailboxId: mid.data };
}

function id(raw: string) {
  if (!WORKER_ID.test(raw)) throw new IamError(404, 'NOT_FOUND', 'Not found.');
  return raw;
}

/** Relays a Worker JSON response, mapping Worker failures to a platform error. */
async function relay(res: Response) {
  if (res.ok) return res.json();
  if (res.status === 404) throw new IamError(404, 'NOT_FOUND', 'Not found.');
  if (res.status === 400) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IamError(400, 'INVALID_ARGUMENT', j?.error?.message ?? 'Invalid request.');
  }
  console.error(JSON.stringify({ message: 'worker error', status: res.status }));
  throw new IamError(502, 'MAIL_UNAVAILABLE', 'Your mail service in Cloudflare did not answer. Try again in a moment.');
}

mail.get('/tenants/:tid/mailboxes/:mid/threads', async (c) => {
  const { worker, mailboxId } = await gate(c, 'mail.read');
  const q = new URLSearchParams();
  for (const key of ['location', 'view', 'label', 'before', 'limit']) {
    const v = c.req.query(key);
    if (v !== undefined && v.length <= 64) q.set(key, v);
  }
  const res = await workerFetch(worker, 'GET', `/v1/mailboxes/${mailboxId}/threads?${q}`);
  return c.json(await relay(res));
});

mail.get('/tenants/:tid/mailboxes/:mid/threads/:thid', async (c) => {
  const { worker, mailboxId } = await gate(c, 'mail.read');
  const res = await workerFetch(worker, 'GET', `/v1/mailboxes/${mailboxId}/threads/${id(c.req.param('thid'))}`);
  return c.json(await relay(res));
});

const patchInput = z
  .object({
    location: z.enum(['inbox', 'archive', 'sent', 'scheduled', 'spam', 'trash']),
    starred: z.boolean(),
    unread: z.boolean(),
    important: z.boolean(),
    labelIds: z.array(z.string().max(64)).max(50),
    snoozedUntil: z.string().datetime().nullable(),
  })
  .partial()
  .strict();

mail.patch('/tenants/:tid/mailboxes/:mid/threads/:thid', async (c) => {
  const { worker, mailboxId } = await gate(c, 'mail.organize');
  const input = await body(c, patchInput);
  if (Object.keys(input).length === 0) throw new IamError(400, 'INVALID_ARGUMENT', 'Nothing to update.');
  const res = await workerFetch(worker, 'PATCH', `/v1/mailboxes/${mailboxId}/threads/${id(c.req.param('thid'))}`, input);
  return c.json(await relay(res));
});

mail.get('/tenants/:tid/mailboxes/:mid/attachments/:aid', async (c) => {
  const { worker, mailboxId } = await gate(c, 'mail.read');
  const res = await workerFetch(worker, 'GET', `/v1/mailboxes/${mailboxId}/attachments/${id(c.req.param('aid'))}`);
  if (!res.ok) return c.json(await relay(res));
  // Streamed through without buffering; never cached by intermediaries.
  const headers = new Headers({
    'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
    'cache-control': 'private, no-store',
    'content-disposition': 'attachment',
  });
  const length = res.headers.get('content-length');
  if (length) headers.set('content-length', length);
  return new Response(res.body, { headers });
});
