import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import { auth, type Session } from './auth.js';
import { IamError } from './iam/policy.js';
import { one } from './db.js';

export type AppEnv = { Variables: { session: Session } };

/** Rejects requests without a valid session. Mobile clients send the session cookie in the Cookie header. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } }, 401);
  if (await one('select 1 from mailbox where account_user_id=$1 and deleting_at is not null',[session.user.id])) {
    return c.json({error:{code:'ACCOUNT_DELETING',message:'This work account is being deleted.'}},401);
  }
  c.set('session', session);
  await next();
});

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => {
    throw new IamError(400, 'INVALID_JSON', 'The request body must be JSON.');
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new IamError(400, 'INVALID_ARGUMENT', first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request.');
  }
  return parsed.data;
}

export const uuid = z.string().uuid();
