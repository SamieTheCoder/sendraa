import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
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
  const mailbox = await one<{address:string}>(`select address from mailbox where tenant_id=$1 and 'tenants/' || tenant_id || '/mailboxes/' || id = $2`,[invite.tenant_id,invite.resource]);
  const existing = !invite.separate_account && await one('select 1 from "user" where email = $1', [invite.email]);
  return c.json({
    workspace: invite.tenant_name,
    workAddress: mailbox?.address ?? null,
    email: invite.email,
    loginEmail: invite.separate_account ? invite.work_address : invite.email,
    separateAccount: invite.separate_account,
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

  if (invite.separate_account) {
    if (!input.name || !input.password) throw new IamError(400, 'INVALID_ARGUMENT', 'Enter your name and a password of at least 10 characters for your work account.');
    // Use the configured Better Auth hasher. Persist the identity, credential and
    // invite grant in one Postgres transaction so failed/replayed invites cannot
    // leave a registered work address behind. Sign-in still goes through Better Auth.
    const passwordHash = await (await auth.$context).password.hash(input.password);
    const userId = randomUUID();
    await transaction(async (db) => {
      const mailbox = await one<{id:string;address:string;owner_user_id:string|null;deleting_at:Date|null}>(
        `select id,address,owner_user_id,deleting_at from mailbox where tenant_id=$1 and 'tenants/'||tenant_id||'/mailboxes/'||id=$2 and not shared for update`, [invite.tenant_id,invite.resource],db);
      if (!mailbox || mailbox.deleting_at || mailbox.owner_user_id) throw new IamError(409,'INVITE_INVALID','This mailbox invitation is no longer available.');
      const spent = await db.query('update invite set accepted_at=now() where id=$1 and accepted_at is null and revoked_at is null and expires_at>now()', [invite.id]);
      if (!spent.rowCount) throw new IamError(409,'INVITE_INVALID','This invite was just used or withdrawn.');
      if (await one('select 1 from "user" where lower(email)=lower($1)',[mailbox.address],db)) throw new IamError(409,'WORK_LOGIN_EXISTS','This work address already has a login. Ask your workspace admin to resolve it; your personal account has not changed.');
      await db.query('insert into "user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,true,now(),now())',[userId,input.name,mailbox.address]);
      await db.query('insert into account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2,\'credential\',$2,$3,now(),now())',[randomUUID(),userId,passwordHash]);
      await db.query('update mailbox set owner_user_id=$2,account_user_id=$2 where id=$1',[mailbox.id,userId]);
      await db.query('update invite set accepted_by=$2 where id=$1',[invite.id,userId]);
      await db.query('insert into tenant_member(tenant_id,user_id) values($1,$2)',[invite.tenant_id,userId]);
      await grant(db,invite.tenant_id,invite.resource,invite.role,userId,null);
      // Possession of this single-use invitation proves control of its recipient.
      await db.query('insert into account_security(user_id,recovery_email,recovery_verified_at) values($1,$2,now())',[userId,invite.email]);
      await audit(db,{tenantId:invite.tenant_id,actorId:userId,action:'invite.accept',resource:invite.resource,metadata:{role:invite.role,separateAccount:true}});
    });
    return c.json({ok:true,workspaceId:invite.tenant_id,loginEmail:invite.work_address,signInRequired:true});
  }

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
    const mailbox = await one<{id:string;address:string;shared:boolean;owner_user_id:string|null;deleting_at:Date|null}>(
      `select id,address,shared,owner_user_id,deleting_at from mailbox where tenant_id=$1 and 'tenants/'||tenant_id||'/mailboxes/'||id=$2 for update`, [invite.tenant_id,invite.resource],db);
    if (invite.resource.includes('/mailboxes/') && (!mailbox || mailbox.deleting_at)) throw new IamError(409,'INVITE_INVALID','This mailbox is no longer available.');
    if (mailbox && !mailbox.shared) {
      if (mailbox.owner_user_id && mailbox.owner_user_id !== userId) throw new IamError(409,'PERSONAL_MAILBOX','This personal mailbox already belongs to someone.');
      await db.query('update mailbox set owner_user_id=$2 where id=$1',[mailbox.id,userId]);
      await db.query('insert into login_alias(address,user_id,mailbox_id) values($1,$2,$3) on conflict do nothing',[mailbox.address,userId,mailbox.id]);
    }
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
