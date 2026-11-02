import { Hono, type MiddlewareHandler } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';
import { APIError } from 'better-auth/api';

import { INVITE_HEADER, auth } from './auth.js';
import { cloudflareConfigured, devAdminSignup, env, recoveryConfigured } from './env.js';
import { isWebOrigin } from './web-origins.js';
import { IamError } from './iam/policy.js';
import { cloudflare } from './routes/cloudflare.js';
import { hooks } from './routes/hooks.js';
import { mail } from './routes/mail.js';
import { invites } from './routes/invites.js';
import { tenants } from './routes/tenants.js';
import { security } from './routes/security.js';
import { accountPages } from './routes/account-pages.js';

export const app = new Hono();

app.use('*', secureHeaders());
// Auth callback URLs contain authorization codes; never put their query strings in logs.
app.use('*', logger((message) => console.log(message.replace(/\?[^\s]*/g, '?[redacted]'))));

app.get('/health', (c) => c.json({ ok: true }));
// Capability discovery is public and contains no user data or credentials.
app.use('/v1/auth/providers', cors({ origin: '*', allowMethods: ['GET'] }));

// The web app calls the API with its session cookie. Only listed web origins may, and only on the
// auth and /v1 routes. Native apps send no Origin header and skip all of this.
const webCors = cors({
  origin: (origin) => (isWebOrigin(origin) ? origin : null),
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization', INVITE_HEADER],
  maxAge: 600,
});
// Session cookies may be sent cross-site on the development API, so a state-changing request from
// a browser must come from an allowed web origin. This also blocks form posts and other "simple"
// requests, which CORS alone lets through.
const sameOriginWrites: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('origin');
  if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !isWebOrigin(origin) && origin !== new URL(env.BETTER_AUTH_URL).origin) {
    return c.json({ error: { code: 'FORBIDDEN_ORIGIN', message: 'This site is not allowed to use Sendraa.' } }, 403);
  }
  await next();
};
for (const path of ['/api/auth/*', '/v1/*']) {
  app.use(path, async (c, next) => (c.req.path === '/v1/auth/providers' ? next() : webCors(c, next)));
}
app.use('/v1/*', sameOriginWrites);

/**
 * Tells the app which sign-in options exist, so it never offers one that cannot work.
 * `devSignup` is only ever true on a local server with ALLOW_DEV_ADMIN_SIGNUP.
 */
app.get('/v1/auth/providers', (c) => c.json({ cloudflare: cloudflareConfigured, password: true, devSignup: devAdminSignup, recovery: recoveryConfigured,
  passkey: { ios: Boolean(env.PASSKEY_RP_ID && env.APPLE_APP_ID), android: Boolean(env.PASSKEY_RP_ID && env.ANDROID_SHA256_FINGERPRINTS), web: Boolean(env.PASSKEY_RP_ID) } }));

app.route('/', accountPages);
app.get('/.well-known/apple-app-site-association', (c) => c.json({ webcredentials: { apps: env.APPLE_APP_ID ? [env.APPLE_APP_ID] : [] } }));
app.get('/.well-known/assetlinks.json', (c) => c.json(env.ANDROID_SHA256_FINGERPRINTS ? [{ relation: ['delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: env.ANDROID_PACKAGE, sha256_cert_fingerprints: env.ANDROID_SHA256_FINGERPRINTS.split(',').map((x) => x.trim()) } }] : []));

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.route('/v1', invites);
app.route('/v1', security);
app.route('/v1', hooks);
app.route('/v1', cloudflare);
app.route('/v1', mail);
app.route('/v1', tenants);

app.onError((err, c) => {
  if (err instanceof APIError) return c.json({ error: { code: err.body?.code ?? 'AUTH_ERROR', message: err.body?.message ?? 'Sign in again and retry.' } }, err.statusCode as 400 | 401 | 403 | 429);
  if (err instanceof IamError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  console.error(err);
  return c.json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Try again.' } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404));
