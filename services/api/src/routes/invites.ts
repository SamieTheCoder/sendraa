import { Hono } from 'hono';
import { z } from 'zod';

import { INVITE_HEADER, auth } from '../auth.js';
import { audit, one, transaction } from '../db.js';
import { body } from '../http.js';
import { IamError, grant } from '../iam/policy.js';
import { getRole } from '../iam/roles.js';
import { findOpenInvite } from '../invites.js';

/** Public invite endpoints. The token in the link is the credential. */
export const invites = new Hono();

invites.get('/invites/:token', async (c) => {
  const invite = await findOpenInvite(c.req.param('token'));
  if (!invite) throw new IamError(404, 'INVITE_INVALID', 'This invite has expired, been used, or been withdrawn. Ask your admin for a new one.');
  const existing = await one('select 1 from "user" where email = $1', [invite.email]);
  return c.json({
    workspace: invite.tenant_name,
    email: invite.email,
    role: getRole(invite.role)?.title ?? invite.role,
    expiresAt: invite.expires_at,
    hasAccount: Boolean(existing),
  });
});

/**
 * Accepts an invite.
 *
 * New people send a name and password and get an account. People who already
 * have a Sendraa account must be signed in as the invited address. Either way
 * the invite's role binding is created and the invite is spent atomically, so
 * a replayed link cannot be used twice.
 */
invites.post('/invites/accept', async (c) => {
  const input = await body(
    c,
    z.object({
      token: z.string(),
      name: z.string().trim().min(1).max(80).optional(),
      password: z.string().min(10).max(128).optional(),
    }),
  );
  const invite = await findOpenInvite(input.token);
  if (!invite) throw new IamError(404, 'INVITE_INVALID', 'This invite has expired, been used, or been withdrawn. Ask your admin for a new one.');

  let userId: string;
  let signUpResponse: Response | null = null;

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new IamError(403, 'WRONG_ACCOUNT', `This invite is for ${invite.email}. Sign out and open the link again.`);
    }
    userId = session.user.id;
  } else {
    const existing = await one('select 1 from "user" where email = $1', [invite.email]);
    if (existing) throw new IamError(409, 'SIGN_IN_REQUIRED', `${invite.email} already has an account. Sign in, then open the invite again.`);
    if (!input.name || !input.password) throw new IamError(400, 'INVALID_ARGUMENT', 'Enter your name and a password of at least 10 characters.');

    signUpResponse = await auth.api.signUpEmail({
      body: { email: invite.email, password: input.password, name: input.name },
      headers: new Headers({ [INVITE_HEADER]: input.token }),
      asResponse: true,
    });
    if (!signUpResponse.ok) {
      const detail = (await signUpResponse.clone().json().catch(() => null)) as { message?: string } | null;
      throw new IamError(400, 'SIGN_UP_FAILED', detail?.message ?? 'Could not create the account.');
    }
    const created = await one<{ id: string }>('select id from "user" where email = $1', [invite.email]);
    userId = created!.id;
  }

  await transaction(async (db) => {
    // Spending the invite inside the transaction makes acceptance single-use under concurrency.
    const spent = await db.query(
      'update invite set accepted_at = now(), accepted_by = $2 where id = $1 and accepted_at is null and revoked_at is null and expires_at > now()',
      [invite.id, userId],
    );
    if (!spent.rowCount) throw new IamError(409, 'INVITE_INVALID', 'This invite was just used or withdrawn.');
    await db.query('insert into tenant_member (tenant_id, user_id) values ($1, $2) on conflict do nothing', [invite.tenant_id, userId]);
    await grant(db, invite.tenant_id, invite.resource, invite.role, userId, null);
    // Opening the link proves the person controls the invited address.
    await db.query('update "user" set "emailVerified" = true where id = $1', [userId]);
    await audit(db, { tenantId: invite.tenant_id, actorId: userId, action: 'invite.accept', resource: invite.resource, metadata: { role: invite.role } });
  });

  const res = c.json({ ok: true, workspaceId: invite.tenant_id });
  // Hand the new session cookie to the client so it is signed in straight away.
  signUpResponse?.headers.getSetCookie().forEach((cookie) => res.headers.append('set-cookie', cookie));
  return res;
});
