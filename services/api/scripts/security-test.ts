import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

// In-process test API; never sends email, calls Cloudflare, or changes real users.
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_ADMIN_SIGNUP = 'true';
process.env.CLOUDFLARE_CLIENT_ID = '';
process.env.CLOUDFLARE_CLIENT_SECRET = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASSWORD = '';
process.env.PASSKEY_RP_ID = '';
process.env.BETTER_AUTH_URL = 'http://localhost:8787';
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { env } = await import('../src/env.js');
const suffix = randomUUID();
const email = `security-${suffix}@example.invalid`;
let userId: string | undefined;
let tenantId: string | undefined;
const cookies = new Map<string, string>();
let passed = 0;
async function call(path: string, body?: unknown, authenticated = true) {
  const response = await app.request(`http://localhost:8787${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:8787', ...(authenticated ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (authenticated) for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]!;
    cookies.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  }
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}
function check(name: string, condition: unknown) { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); }
try {
  check('security endpoint requires a session', (await call('/v1/security/account', undefined, false)).status === 401);
  check('password setup requires a session', (await call('/v1/security/password', { newPassword: 'a-long-test-password' }, false)).status === 401);
  const created = await call('/api/auth/sign-up/email', { email, name: 'Security test', password: 'a-long-test-password' });
  assert.equal(created.status, 200);
  userId = created.body.user.id;
  check('account reports password state', (await call('/v1/security/account')).body.hasPassword === true);
  check('first-password endpoint cannot overwrite a password', (await call('/v1/security/password', { newPassword: 'another-long-password' })).status === 400);
  await pool.query('delete from account where "userId" = $1 and "providerId" = $2', [userId, 'credential']);
  check('OAuth-only account has no password', (await call('/v1/security/account')).body.hasPassword === false);
  check('fresh owner can set first password', (await call('/v1/security/password', { newPassword: 'another-long-password' })).status === 200);
  check('recovery fails clearly when SMTP is absent', (await call('/v1/security/recovery', { email: 'alternate@example.invalid' })).status === 503);
  const code = '12345678';
  const hash = createHmac('sha256', env.BETTER_AUTH_SECRET).update(`${userId}:${code}`).digest('hex');
  await pool.query(`insert into account_security(user_id, pending_email, verification_hash, verification_expires_at) values ($1, $2, $3, now() + interval '15 minutes')`, [userId, 'alternate@example.invalid', hash]);
  check('pending address is not a recovery address', (await call('/v1/security/account')).body.recoveryEmail === null);
  check('wrong verification code fails', (await call('/v1/security/recovery/verify', { code: '00000000' })).status === 400);
  const verified = await Promise.all([call('/v1/security/recovery/verify', { code }), call('/v1/security/recovery/verify', { code })]);
  check('concurrent code redemption succeeds exactly once', verified.filter((r) => r.status === 200).length === 1);
  check('verified address becomes active', (await call('/v1/security/account')).body.recoveryEmail === 'alternate@example.invalid');
  await pool.query(`update account_security set pending_email = 'other@example.invalid', verification_hash = $2, verification_expires_at = now() - interval '1 second', verification_attempts = 0 where user_id = $1`, [userId, hash]);
  check('expired recovery code fails', (await call('/v1/security/recovery/verify', { code })).status === 400);
  await pool.query(`update account_security set verification_expires_at = now() + interval '15 minutes', verification_attempts = 5 where user_id = $1`, [userId]);
  check('attempt limit cannot be bypassed with correct code', (await call('/v1/security/recovery/verify', { code })).status === 400);
  check('failed replacement preserves original recovery email', (await call('/v1/security/account')).body.recoveryEmail === 'alternate@example.invalid');
  tenantId = (await pool.query('insert into tenant(name, created_by) values ($1, $2) returning id', ['Security test', userId])).rows[0].id;
  await pool.query('insert into tenant_member(tenant_id,user_id) values ($1,$2)', [tenantId,userId]);
  const domain = (await pool.query('insert into domain(tenant_id,name) values ($1,$2) returning id', [tenantId, `${suffix}.invalid`])).rows[0].id;
  const address = `admin@${suffix}.invalid`;
  const mailbox = (await pool.query('insert into mailbox(tenant_id,domain_id,address) values ($1,$2,$3) returning id', [tenantId,domain,address])).rows[0].id;
  await pool.query('insert into login_alias(address,user_id,mailbox_id) values ($1,$2,$3)', [address,userId,mailbox]);
  check('admin alias signs in to the same identity', (await call('/api/auth/sign-in/email', { email: address, password: 'another-long-password' })).body.user?.id === userId);
  await pool.query('delete from tenant_member where tenant_id = $1 and user_id = $2', [tenantId,userId]);
  check('removed member cannot sign in through workspace alias', (await call('/api/auth/sign-in/email', { email: address, password: 'another-long-password' })).status === 401);
  const { auth } = await import('../src/auth.js');
  const context = await auth.$context;
  const resetToken = randomUUID();
  await context.internalAdapter.createVerificationValue({ identifier: `reset-password:${resetToken}`, value: userId!, expiresAt: new Date(Date.now() + 60_000) });
  check('password reset rejects a short password without spending the token', (await call('/api/auth/reset-password', { token: resetToken, newPassword: 'short' })).status === 400);
  check('password reset accepts a valid token', (await call('/api/auth/reset-password', { token: resetToken, newPassword: 'reset-test-password-long' })).status === 200);
  check('password reset revokes existing sessions', (await call('/v1/security/account')).status === 401);
  check('password reset token cannot be replayed', (await call('/api/auth/reset-password', { token: resetToken, newPassword: 'replay-test-password-long' })).status === 400);
  check('new password signs in successfully', (await call('/api/auth/sign-in/email', { email, password: 'reset-test-password-long' })).body.user?.id === userId);
  const limits = await Promise.all(Array.from({ length: 11 }, () => call('/api/auth/sign-in/social', { provider: 'missing' }, false)));
  const limited = limits.find((r) => r.status === 429);
  check('sign-in rate limit remains enforced with retry header', Boolean(limited?.headers.get('x-retry-after')));
  for (const name of ['privacy','terms']) {
    const response = await app.request(`http://localhost:8787/legal/${name}`);
    check(`${name} is readable without authentication`, response.status === 200 && (await response.text()).includes('Sendraa'));
  }
  const resetPage = await app.request('http://localhost:8787/account/reset');
  check('reset page is not cached', resetPage.headers.get('cache-control') === 'no-store');
  console.log(`${passed} security checks passed.`);
} finally {
  if (tenantId) await pool.query('delete from tenant where id = $1', [tenantId]);
  if (userId) await pool.query('delete from "user" where id = $1', [userId]);
  await pool.end();
}
