import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';

import { auth } from '../auth.js';
import { one, query, transaction } from '../db.js';
import { env, recoveryConfigured } from '../env.js';
import { body, requireSession, type AppEnv } from '../http.js';
import { IamError } from '../iam/policy.js';
import { sendSecurityMail } from '../security-mail.js';

export const security = new Hono<AppEnv>();
security.use('/security/*', requireSession);
const digest = (userId: string, code: string) => createHmac('sha256', env.BETTER_AUTH_SECRET).update(`${userId}:${code}`).digest('hex');

security.get('/security/account', async (c) => {
  const { user } = c.get('session');
  const credential = await one('select 1 from account where "userId" = $1 and "providerId" = $2 and password is not null', [user.id, 'credential']);
  const recovery = await one<{ recovery_email: string | null; recovery_verified_at: string | null; pending_email: string | null }>('select recovery_email, recovery_verified_at, pending_email from account_security where user_id = $1', [user.id]);
  const aliases = await query<{ address: string }>(`select a.address from login_alias a join mailbox m on m.id = a.mailbox_id join tenant_member tm on tm.tenant_id = m.tenant_id and tm.user_id = a.user_id where a.user_id = $1 and not m.shared`, [user.id]);
  return c.json({ email: user.email, aliases: aliases.map((a) => a.address), hasPassword: Boolean(credential), recoveryEmail: recovery?.recovery_verified_at ? recovery.recovery_email : null, pendingEmail: recovery?.pending_email ?? null, recoveryAvailable: recoveryConfigured });
});

security.post('/security/password', async (c) => {
  const input = await body(c, z.object({ newPassword: z.string().min(10).max(128) }));
  // Better Auth enforces a fresh session and refuses to overwrite a password.
  await auth.api.setPassword({ headers: c.req.raw.headers, body: input });
  return c.json({ ok: true });
});

security.post('/security/recovery', async (c) => {
  if (!recoveryConfigured) throw new IamError(503, 'RECOVERY_UNAVAILABLE', 'Recovery email is not available yet. You can still sign in with Cloudflare.');
  const { user, session } = c.get('session');
  if (Date.now() - new Date(session.createdAt).getTime() > 15 * 60_000) throw new IamError(403, 'FRESH_LOGIN_REQUIRED', 'Sign in again before changing your recovery email.');
  const { email } = await body(c, z.object({ email: z.email().trim().toLowerCase().max(254) }));
  const internal = await one('select 1 from domain where name = $1', [email.split('@')[1]]);
  if (internal) throw new IamError(400, 'EXTERNAL_EMAIL_REQUIRED', 'Use an address outside Sendraa so you can recover access when you cannot open your mailbox.');
  const code = String(randomInt(10_000_000, 100_000_000));
  const claimed = await one(`insert into account_security(user_id, pending_email, verification_hash, verification_expires_at, last_sent_at)
    values ($1, $2, $3, now() + interval '15 minutes', now())
    on conflict(user_id) do update set pending_email = excluded.pending_email, verification_hash = excluded.verification_hash,
    verification_expires_at = excluded.verification_expires_at, verification_attempts = 0, last_sent_at = now()
    where account_security.last_sent_at < now() - interval '1 minute' returning user_id`, [user.id, email, digest(user.id, code)]);
  if (!claimed) throw new IamError(429, 'RATE_LIMITED', 'Wait a minute before requesting another code.');
  try {
    await sendSecurityMail(email, 'Verify your Sendraa recovery email', `Your Sendraa verification code is ${code}.\n\nEnter it in Sendraa to confirm this recovery address. It expires in 15 minutes. Never share this code.\n\nIf you did not request this, ignore this email.`);
  } catch {
    await query('update account_security set verification_hash = null, verification_expires_at = null where user_id = $1 and verification_hash = $2', [user.id, digest(user.id, code)]);
    throw new IamError(503, 'EMAIL_DELIVERY_FAILED', 'We could not send the code. Your current recovery address has not changed. Try again in a minute.');
  }
  return c.json({ ok: true });
});

security.post('/security/recovery/verify', async (c) => {
  const { code } = await body(c, z.object({ code: z.string().regex(/^\d{8}$/) }));
  const { user } = c.get('session');
  const accepted = await transaction(async (db) => {
    const row = await one<{ verification_hash: string }>(`update account_security set verification_attempts = verification_attempts + 1
      where user_id = $1 and verification_expires_at > now() and verification_attempts < 5 and verification_hash is not null returning verification_hash`, [user.id], db);
    if (!row || !timingSafeEqual(Buffer.from(row.verification_hash, 'hex'), Buffer.from(digest(user.id, code), 'hex'))) return false;
    await db.query(`update account_security set recovery_email = pending_email, recovery_verified_at = now(), pending_email = null,
      verification_hash = null, verification_expires_at = null where user_id = $1`, [user.id]);
    return true;
  });
  if (!accepted) throw new IamError(400, 'INVALID_CODE', 'That code is invalid or expired. Request a new code after five unsuccessful attempts.');
  return c.json({ ok: true });
});
