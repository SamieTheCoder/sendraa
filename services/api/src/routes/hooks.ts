import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { enqueueMail } from '../push.js';
import { Hono } from 'hono';

import { open } from '../crypto.js';
import { one } from '../db.js';

/**
 * F9 entry point: the tenant Worker reports new mail here. The payload holds
 * ids only, never mail content. It is signed with the tenant's Worker secret as
 * `x-sendraa-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 * Valid events enqueue Expo deliveries without persisting message content.
 */
export const hooks = new Hono();

hooks.use('*',bodyLimit({maxSize:4096}));
const eventSchema=z.object({tenantId:z.uuid(),mailboxId:z.uuid(),threadId:z.uuid(),messageId:z.uuid(),event:z.literal('message.received')});

const TOLERANCE_SECONDS = 300;

hooks.post('/hooks/mail', async (c) => {
  const raw = await c.req.text();
  if (raw.length > 4096) return c.body(null, 413);
  const sig = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(c.req.header('x-sendraa-signature') ?? '');
  let payload: { tenantId?: unknown; event?: unknown; mailboxId?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.body(null, 400);
  }
  if (!sig || typeof payload.tenantId !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.tenantId)) return c.body(null, 401);
  if (Math.abs(Date.now() / 1000 - Number(sig[1])) > TOLERANCE_SECONDS) return c.body(null, 401);

  const tenant = await one<{ worker_secret_enc: string | null }>('select worker_secret_enc from tenant where id = $1', [payload.tenantId]);
  if (!tenant?.worker_secret_enc) return c.body(null, 401);
  const expected = createHmac('sha256', open(tenant.worker_secret_enc)).update(`${sig[1]}.${raw}`).digest();
  const given = Buffer.from(sig[2]!, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return c.body(null, 401);

  const event=eventSchema.safeParse(payload);
  if(!event.success)return c.body(null,400);
  await enqueueMail(event.data);
  return c.body(null, 204);
});
