import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { auth } from './auth.js';
import { cloudflareConfigured, devAdminSignup } from './env.js';
import { IamError } from './iam/policy.js';
import { invites } from './routes/invites.js';
import { tenants } from './routes/tenants.js';

export const app = new Hono();

app.use('*', secureHeaders());
app.use('*', logger());

app.get('/health', (c) => c.json({ ok: true }));

/**
 * Tells the app which sign-in options exist, so it never offers one that cannot work.
 * `devSignup` is only ever true on a local server with ALLOW_DEV_ADMIN_SIGNUP.
 */
app.get('/v1/auth/providers', (c) => c.json({ cloudflare: cloudflareConfigured, password: true, devSignup: devAdminSignup }));

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.route('/v1', invites);
app.route('/v1', tenants);

app.onError((err, c) => {
  if (err instanceof IamError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  console.error(err);
  return c.json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Try again.' } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404));
