import { Hono } from 'hono';
import { z } from 'zod';

import { audit, one, query, transaction } from '../db.js';
import { devAdminSignup, env } from '../env.js';
import { body, requireSession, uuid, type AppEnv } from '../http.js';
import {
  IamError,
  assertCanChange,
  assertCanGrantRole,
  assertNotLastOwner,
  authorize,
  effectivePermissions,
  effectiveRoles,
  getPolicy,
  grant,
  resolveResource,
  revoke,
} from '../iam/policy.js';
import { PERMISSIONS, ROLES, mailboxResource, tenantResource, type Permission } from '../iam/roles.js';
import { hashToken, newToken } from '../invites.js';

export const tenants = new Hono<AppEnv>();
tenants.use('*', requireSession);

const tenantOf = (id: string) => ({ kind: 'tenant' as const, tenantId: id, name: tenantResource(id) });

function tenantId(raw: string) {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw new IamError(404, 'NOT_FOUND', 'Not found.');
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

tenants.get('/me', async (c) => {
  const { user } = c.get('session');
  const memberships = await query<{ id: string; name: string }>(
    `select t.id, t.name from tenant t join tenant_member m on m.tenant_id = t.id where m.user_id = $1 order by t.created_at`,
    [user.id],
  );
  const workspaces = await Promise.all(
    memberships.map(async (t) => ({
      id: t.id,
      name: t.name,
      roles: await effectiveRoles(user.id, tenantOf(t.id)),
      permissions: [...(await effectivePermissions(user.id, tenantOf(t.id)))],
    })),
  );
  const cloudflare = await one('select 1 from account where "userId" = $1 and "providerId" = $2', [user.id, 'cloudflare']);
  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    signedInWithCloudflare: Boolean(cloudflare),
    canCreateWorkspace: Boolean(cloudflare) || devAdminSignup,
    workspaces,
  });
});

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

tenants.post('/tenants', async (c) => {
  const { user } = c.get('session');
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80) }));

  const cloudflare = await one('select 1 from account where "userId" = $1 and "providerId" = $2', [user.id, 'cloudflare']);
  if (!cloudflare && !devAdminSignup) {
    throw new IamError(403, 'CLOUDFLARE_REQUIRED', 'Sign in with Cloudflare to create a workspace. The workspace runs in that Cloudflare account.');
  }

  const tenant = await transaction(async (db) => {
    const t = await one<{ id: string; name: string }>('insert into tenant (name, created_by) values ($1, $2) returning id, name', [input.name, user.id], db);
    await db.query('insert into tenant_member (tenant_id, user_id) values ($1, $2)', [t!.id, user.id]);
    await grant(db, t!.id, tenantResource(t!.id), 'roles/owner', user.id, user.id);
    await audit(db, { tenantId: t!.id, actorId: user.id, action: 'tenant.create', resource: tenantResource(t!.id) });
    return t!;
  });
  return c.json(tenant, 201);
});

tenants.get('/tenants/:tid', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  await authorize(user.id, 'tenant.get', tenantOf(id));
  return c.json(await one('select id, name, created_at from tenant where id = $1', [id]));
});

// ---------------------------------------------------------------------------
// IAM
// ---------------------------------------------------------------------------

/** The role catalogue, like Google's roles.list. */
tenants.get('/roles', (c) => c.json({ roles: ROLES, permissions: PERMISSIONS }));

/** Like Google's testIamPermissions. The app uses this to decide which controls to show. */
tenants.post('/tenants/:tid/iam:test', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  const input = await body(c, z.object({ resource: z.string(), permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length) }));
  const resource = await resolveResource(input.resource, id);
  const held = await effectivePermissions(user.id, resource);
  return c.json({ permissions: input.permissions.filter((p: Permission) => held.has(p)) });
});

tenants.get('/tenants/:tid/iam', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  const resource = await resolveResource(c.req.query('resource') ?? tenantResource(id), id);
  await authorize(user.id, 'iam.policy.get', resource);
  return c.json({ resource: resource.name, bindings: await getPolicy(resource.name) });
});

const bindingInput = z.object({ resource: z.string(), role: z.string(), userId: z.string().min(1) });

tenants.post('/tenants/:tid/iam/bindings', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  const input = await body(c, bindingInput);
  await transaction(async (db) => {
    const resource = await resolveResource(input.resource, id, db);
    await assertCanChange(db, user.id, resource, input.role, 'grant', input.userId);
    await grant(db, id, resource.name, input.role, input.userId, user.id);
    await audit(db, { tenantId: id, actorId: user.id, action: 'iam.grant', resource: resource.name, metadata: { role: input.role, userId: input.userId } });
  });
  return c.json({ ok: true }, 201);
});

tenants.delete('/tenants/:tid/iam/bindings', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  const input = await body(c, bindingInput);
  await transaction(async (db) => {
    const resource = await resolveResource(input.resource, id, db);
    await assertCanChange(db, user.id, resource, input.role, 'revoke', input.userId);
    await revoke(db, resource.name, input.role, input.userId);
    await audit(db, { tenantId: id, actorId: user.id, action: 'iam.revoke', resource: resource.name, metadata: { role: input.role, userId: input.userId } });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Domains and mailboxes
// ---------------------------------------------------------------------------

const DOMAIN = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

tenants.get('/tenants/:tid/domains', async (c) => {
  const id = tenantId(c.req.param('tid'));
  await authorize(c.get('session').user.id, 'domains.list', tenantOf(id));
  return c.json({ domains: await query('select id, name, verified_at, created_at from domain where tenant_id = $1 order by name', [id]) });
});

tenants.post('/tenants/:tid/domains', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  await authorize(user.id, 'domains.create', tenantOf(id));
  const input = await body(c, z.object({ name: z.string().trim().toLowerCase().regex(DOMAIN, 'Enter a domain like northwind.com') }));
  const taken = await one('select 1 from domain where name = $1', [input.name]);
  if (taken) throw new IamError(409, 'DOMAIN_TAKEN', `${input.name} is already connected to a workspace.`);
  const domain = await transaction(async (db) => {
    const d = await one('insert into domain (tenant_id, name) values ($1, $2) returning id, name, verified_at', [id, input.name], db);
    await audit(db, { tenantId: id, actorId: user.id, action: 'domain.create', metadata: { name: input.name } });
    return d;
  });
  return c.json(domain, 201);
});

tenants.get('/tenants/:tid/mailboxes', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  // Any member may ask; the answer is filtered to what they can access.
  const member = await one('select 1 from tenant_member where tenant_id = $1 and user_id = $2', [id, user.id]);
  if (!member) throw new IamError(404, 'NOT_FOUND', 'Not found.');
  const all = await query<{ id: string; address: string; display_name: string; shared: boolean }>(
    'select id, address, display_name, shared from mailbox where tenant_id = $1 order by address',
    [id],
  );
  // Admins see every mailbox. Everyone else sees the mailboxes they can read.
  const tenantPerms = await effectivePermissions(user.id, tenantOf(id));
  if (tenantPerms.has('mailboxes.update')) return c.json({ mailboxes: all });
  const visible = [];
  for (const m of all) {
    const perms = await effectivePermissions(user.id, { kind: 'mailbox', tenantId: id, mailboxId: m.id, name: mailboxResource(id, m.id) });
    if (perms.has('mail.read')) visible.push({ ...m, canSend: perms.has('mail.send') });
  }
  return c.json({ mailboxes: visible });
});

tenants.post('/tenants/:tid/mailboxes', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  await authorize(user.id, 'mailboxes.create', tenantOf(id));
  const input = await body(
    c,
    z.object({
      localPart: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/, 'Use letters, numbers, dots, dashes or underscores'),
      domainId: uuid,
      displayName: z.string().trim().max(80).default(''),
      shared: z.boolean().default(false),
    }),
  );
  const domain = await one<{ name: string }>('select name from domain where id = $1 and tenant_id = $2', [input.domainId, id]);
  if (!domain) throw new IamError(404, 'NOT_FOUND', 'Domain not found.');
  const address = `${input.localPart}@${domain.name}`;
  const exists = await one('select 1 from mailbox where address = $1', [address]);
  if (exists) throw new IamError(409, 'MAILBOX_EXISTS', `${address} already exists.`);

  const mailbox = await transaction(async (db) => {
    const m = await one(
      'insert into mailbox (tenant_id, domain_id, address, display_name, shared) values ($1, $2, $3, $4, $5) returning id, address, display_name, shared',
      [id, input.domainId, address, input.displayName, input.shared],
      db,
    );
    await audit(db, { tenantId: id, actorId: user.id, action: 'mailbox.create', metadata: { address } });
    return m;
  });
  return c.json(mailbox, 201);
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

tenants.get('/tenants/:tid/members', async (c) => {
  const id = tenantId(c.req.param('tid'));
  await authorize(c.get('session').user.id, 'members.list', tenantOf(id));
  const members = await query<{ id: string; email: string; name: string; joined_at: Date }>(
    `select u.id, u.email, u.name, m.created_at as joined_at
       from tenant_member m join "user" u on u.id = m.user_id
      where m.tenant_id = $1 order by u.email`,
    [id],
  );
  const bindings = await query<{ user_id: string; resource: string; role: string }>(
    'select user_id, resource, role from iam_binding where tenant_id = $1',
    [id],
  );
  return c.json({
    members: members.map((m) => ({ ...m, bindings: bindings.filter((b) => b.user_id === m.id).map(({ resource, role }) => ({ resource, role })) })),
  });
});

tenants.delete('/tenants/:tid/members/:uid', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const target = c.req.param('uid');
  const { user } = c.get('session');
  await transaction(async (db) => {
    await authorize(user.id, 'members.remove', tenantOf(id), db);
    const roles = await effectiveRoles(target, tenantOf(id), db);
    if (roles.includes('roles/owner')) {
      if (!(await effectiveRoles(user.id, tenantOf(id), db)).includes('roles/owner')) {
        throw new IamError(403, 'OWNER_REQUIRED', 'Only an owner can remove an owner.');
      }
      await assertNotLastOwner(db, id, target);
    }
    await db.query('delete from iam_binding where tenant_id = $1 and user_id = $2', [id, target]);
    const removed = await db.query('delete from tenant_member where tenant_id = $1 and user_id = $2', [id, target]);
    if (!removed.rowCount) throw new IamError(404, 'NOT_FOUND', 'That person is not in this workspace.');
    await audit(db, { tenantId: id, actorId: user.id, action: 'member.remove', metadata: { userId: target } });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

tenants.post('/tenants/:tid/invites', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  const input = await body(
    c,
    z.object({
      email: z.string().trim().toLowerCase().email(),
      role: z.string(),
      resource: z.string().optional(),
    }),
  );

  const result = await transaction(async (db) => {
    await authorize(user.id, 'members.invite', tenantOf(id), db);
    const resource = await resolveResource(input.resource ?? tenantResource(id), id, db);
    const self = input.email === user.email.toLowerCase();
    await assertCanGrantRole(db, user.id, resource, input.role, self);

    const open = await one<{ n: number }>('select count(*)::int as n from invite where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()', [id], db);
    if ((open?.n ?? 0) >= env.MAX_OPEN_INVITES) {
      throw new IamError(409, 'TOO_MANY_INVITES', `This workspace has ${env.MAX_OPEN_INVITES} open invites. Revoke some before sending more.`);
    }
    // Replace an earlier open invite to the same address instead of failing.
    await db.query('update invite set revoked_at = now() where tenant_id = $1 and email = $2 and accepted_at is null and revoked_at is null', [id, input.email]);

    const token = newToken();
    const invite = await one<{ id: string; expires_at: Date }>(
      `insert into invite (tenant_id, email, resource, role, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7)) returning id, expires_at`,
      [id, input.email, resource.name, input.role, hashToken(token), user.id, env.INVITE_TTL_DAYS],
      db,
    );
    await audit(db, { tenantId: id, actorId: user.id, action: 'invite.create', resource: resource.name, metadata: { email: input.email, role: input.role } });
    return { ...invite!, token };
  });

  // The raw token leaves the server exactly once, inside this link.
  return c.json(
    {
      id: result.id,
      expiresAt: result.expires_at,
      inviteUrl: `${env.APP_SCHEME}://invite/${result.token}`,
      webUrl: `${env.BETTER_AUTH_URL}/invite/${result.token}`,
    },
    201,
  );
});

tenants.get('/tenants/:tid/invites', async (c) => {
  const id = tenantId(c.req.param('tid'));
  await authorize(c.get('session').user.id, 'members.list', tenantOf(id));
  const invites = await query(
    `select id, email, resource, role, expires_at, created_at from invite
      where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()
      order by created_at desc`,
    [id],
  );
  return c.json({ invites });
});

tenants.delete('/tenants/:tid/invites/:iid', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  await authorize(user.id, 'members.invite', tenantOf(id));
  const inviteId = uuid.safeParse(c.req.param('iid'));
  if (!inviteId.success) throw new IamError(404, 'NOT_FOUND', 'Invite not found.');
  const result = await transaction(async (db) => {
    const r = await db.query('update invite set revoked_at = now() where id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null', [inviteId.data, id]);
    if (r.rowCount) await audit(db, { tenantId: id, actorId: user.id, action: 'invite.revoke', metadata: { inviteId: inviteId.data } });
    return r.rowCount;
  });
  if (!result) throw new IamError(404, 'NOT_FOUND', 'Invite not found.');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

tenants.get('/tenants/:tid/audit', async (c) => {
  const id = tenantId(c.req.param('tid'));
  await authorize(c.get('session').user.id, 'audit.read', tenantOf(id));
  const rows = await query(
    `select a.id, a.action, a.resource, a.metadata, a.created_at, u.email as actor
       from audit_log a left join "user" u on u.id = a.actor_id
      where a.tenant_id = $1 order by a.created_at desc limit 100`,
    [id],
  );
  return c.json({ entries: rows });
});
