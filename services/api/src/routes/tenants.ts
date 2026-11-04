import { Hono } from 'hono';
import { z } from 'zod';
import { loadArtifact } from '@sendraa/mail-worker/artifact';

import { audit, one, query, transaction } from '../db.js';
import { cloudflareError, cloudflareFor } from '../cloudflare.js';
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
import { STEPS, claimSetup, provision } from '../provision.js';
import { syncMailbox } from '../mailbox-sync.js';
import { deliverInvite } from '../invite-delivery.js';
import { readyWorker, workerFetch } from '../worker-client.js';


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
  const memberships = await query<{ id: string; name: string; setup_status: string; cloudflare_account_id: string | null }>(
    `select t.id, t.name, t.setup_status, t.cloudflare_account_id from tenant t join tenant_member m on m.tenant_id = t.id where m.user_id = $1 order by t.created_at`,
    [user.id],
  );
  const workspaces = await Promise.all(
    memberships.map(async (t) => ({
      id: t.id,
      name: t.name,
      // ready once the mail system exists in the tenant's Cloudflare account
      setupStatus: t.setup_status,
      linkedToCloudflare: Boolean(t.cloudflare_account_id),
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
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      cloudflareAccountId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
    }),
  );

  const cloudflare = await one('select 1 from account where "userId" = $1 and "providerId" = $2', [user.id, 'cloudflare']);
  if (!cloudflare && !devAdminSignup) {
    throw new IamError(403, 'CLOUDFLARE_REQUIRED', 'Sign in with Cloudflare to create a workspace. The workspace runs in that Cloudflare account.');
  }

  // A Cloudflare admin must say which account the mail runs in, and the
  // account must be one their consent actually shared.
  let cfAccount: { id: string; name: string } | null = null;
  if (cloudflare) {
    if (!input.cloudflareAccountId) throw new IamError(400, 'INVALID_ARGUMENT', 'Choose the Cloudflare account this workspace runs in.');
    const cf = await cloudflareFor(user.id);
    const accounts = await cf.listAccounts().catch(cloudflareError);
    cfAccount = accounts.find((a) => a.id === input.cloudflareAccountId) ?? null;
    if (!cfAccount) throw new IamError(404, 'NOT_FOUND', 'That Cloudflare account was not shared with Sendraa.');
    const taken = await one('select 1 from tenant where cloudflare_account_id = $1', [cfAccount.id]);
    if (taken) throw new IamError(409, 'CLOUDFLARE_ACCOUNT_IN_USE', `${cfAccount.name} already has a Sendraa workspace. Ask its owner to invite you.`);
  }

  const tenant = await transaction(async (db) => {
    const t = await one<{ id: string; name: string }>(
      `insert into tenant (name, created_by, cloudflare_account_id, cloudflare_account_name, cloudflare_user_id)
       values ($1, $2, $3, $4, $5) returning id, name`,
      [input.name, user.id, cfAccount?.id ?? null, cfAccount?.name ?? null, cfAccount ? user.id : null],
      db,
    );
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
  return c.json(await one('select id, name, cloudflare_account_id, cloudflare_account_name, created_at from tenant where id = $1', [id]));
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
    'select id, address, display_name, shared, synced_at, owner_user_id, account_user_id, deleting_at from mailbox where tenant_id = $1 order by address',
    [id],
  );
  // Admins see every mailbox. Everyone else sees the mailboxes they can read.
  const tenantPerms = await effectivePermissions(user.id, tenantOf(id));
  if (c.req.query('manage') === 'true') {
    await authorize(user.id, 'mailboxes.list', tenantOf(id));
    if (!tenantPerms.has('mailboxes.update')) throw new IamError(403, 'PERMISSION_DENIED', 'Mailbox management access is required.');
    return c.json({ mailboxes: all });
  }
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
  const domain = await one<{ name: string; verified_at: Date | null }>('select name, verified_at from domain where id = $1 and tenant_id = $2', [input.domainId, id]);
  if (!domain) throw new IamError(404, 'NOT_FOUND', 'Domain not found.');
  if (!domain.verified_at) throw new IamError(409, 'DOMAIN_NOT_READY', 'Finish Email setup for this domain before creating mailboxes.');
  const address = `${input.localPart}@${domain.name}`;
  const exists = await one('select 1 from mailbox where address = $1', [address]);
  if (exists) throw new IamError(409, 'MAILBOX_EXISTS', `${address} already exists.`);

  const mailbox = await transaction(async (db) => {
    const m = await one<{ id: string; address: string; display_name: string; shared: boolean }>(
      'insert into mailbox (tenant_id, domain_id, address, display_name, shared, owner_user_id) values ($1, $2, $3, $4, $5, $6) returning id, address, display_name, shared',
      [id, input.domainId, address, input.displayName, input.shared, input.shared ? null : user.id],
      db,
    );
    if (!input.shared) {
      await grant(db,id,mailboxResource(id,m!.id),'roles/mailUser',user.id,user.id);
      await db.query('insert into login_alias(address,user_id,mailbox_id) values($1,$2,$3)',[address,user.id,m!.id]);
    }
    await audit(db, { tenantId: id, actorId: user.id, action: 'mailbox.create', metadata: { address } });
    return m;
  });
  let syncError: string | null = null;
  try { await syncMailbox(id, mailbox!.id); } catch (err) { syncError = err instanceof IamError ? err.message : 'Mailbox saved. Retry activation when the mail Worker is available.'; }
  return c.json({ ...mailbox, active: !syncError, syncError }, 201);
});

tenants.post('/tenants/:tid/mailboxes/:mid/activate', async (c) => {
  const id = tenantId(c.req.param('tid')); const mid = tenantId(c.req.param('mid'));
  await authorize(c.get('session').user.id, 'mailboxes.update', tenantOf(id));
  await syncMailbox(id, mid);
  return c.json({ ok: true });
});

tenants.delete('/tenants/:tid/mailboxes/:mid', async (c) => {
  const tid=tenantId(c.req.param('tid')); const mid=tenantId(c.req.param('mid')); const actorId=c.get('session').user.id;
  await authorize(actorId,'mailboxes.delete',tenantOf(tid));
  const input=await body(c,z.object({confirmAddress:z.string().trim().toLowerCase()}).strict());
  const worker=await readyWorker(tid);
  const health=await workerFetch(worker,'GET','/v1/health').then((r)=>r.ok?r.json():null) as {capabilities?:string[]}|null;
  if (!health?.capabilities?.includes('mailbox-delete')) throw new IamError(409,'WORKER_UPDATE_REQUIRED','Update Email setup before deleting a mailbox.');
  await transaction(async(db)=>{
    await db.query('select id from tenant where id=$1 for update',[tid]);
    const mailbox=await one<{address:string;account_user_id:string|null}>('select address,account_user_id from mailbox where id=$1 and tenant_id=$2 for update',[mid,tid],db);
    if(!mailbox)throw new IamError(404,'NOT_FOUND','Mailbox not found.');
    if(input.confirmAddress!==mailbox.address.toLowerCase())throw new IamError(400,'CONFIRM_ADDRESS','Enter the mailbox address to confirm deletion.');
    if(mailbox.account_user_id && (await one('select 1 from tenant where cloudflare_user_id=$1 or created_by=$1',[mailbox.account_user_id],db) || await one("select 1 from iam_binding where user_id=$1 and role='roles/owner'",[mailbox.account_user_id],db) || await one('select 1 from mailbox where owner_user_id=$1 and id<>$2',[mailbox.account_user_id,mid],db))) throw new IamError(409,'ACCOUNT_IN_USE','This work login also owns a workspace or another mailbox. Transfer that ownership before deleting it.');
    if(await one('select 1 from sending_config where tenant_id=$1 and default_mailbox_id=$2',[tid,mid],db)) throw new IamError(409,'DEFAULT_SENDER','Choose another default workspace sender in Sending before deleting this mailbox.');
    if(await one("select 1 from delivery_log where mailbox_id=$1 and status in ('sending','unknown','accepted') limit 1",[mid],db))throw new IamError(409,'SEND_PENDING','Resolve pending sending attempts before deleting this mailbox.');
    await db.query('update mailbox set deleting_at=coalesce(deleting_at,now()) where id=$1',[mid]);
    // A recreated address must be enabled explicitly for its new mailbox owner.
    await db.query('update sending_config set allowed_from=allowed_from - $2::text where tenant_id=$1',[tid,mailbox.address]);
    if(mailbox.account_user_id) await db.query('delete from session where "userId"=$1',[mailbox.account_user_id]);
    await db.query('update invite set revoked_at=now() where resource=$1 and accepted_at is null and revoked_at is null',[mailboxResource(tid,mid)]);
  });
  const response=await workerFetch(worker,'DELETE',`/v1/mailboxes/${mid}`).catch(()=>null);
  if(!response?.ok)throw new IamError(502,'MAILBOX_DELETE_PENDING','Mailbox access is disabled. Retry deletion to finish removing its mail from Cloudflare.');
  const result=await response.json() as {done?:boolean};
  if(!result.done)return c.json({done:false},202);
  await transaction(async(db)=>{
    const mailbox=await one<{account_user_id:string|null;owner_user_id:string|null}>('select account_user_id,owner_user_id from mailbox where id=$1 and tenant_id=$2 for update',[mid,tid],db);
    if(mailbox?.account_user_id && (await one('select 1 from tenant where cloudflare_user_id=$1 or created_by=$1',[mailbox.account_user_id],db) || await one("select 1 from iam_binding where user_id=$1 and role='roles/owner'",[mailbox.account_user_id],db) || await one('select 1 from mailbox where owner_user_id=$1 and id<>$2',[mailbox.account_user_id,mid],db))) throw new IamError(409,'ACCOUNT_IN_USE','This work login acquired other ownership while deletion was running. Transfer that ownership, then retry to finish deletion.');
    await db.query('delete from iam_binding where tenant_id=$1 and resource=$2',[tid,mailboxResource(tid,mid)]);
    await db.query('delete from mailbox where id=$1 and tenant_id=$2',[mid,tid]);
    if(mailbox?.account_user_id) await db.query('delete from "user" where id=$1',[mailbox.account_user_id]);
    else if(mailbox?.owner_user_id) await db.query('delete from tenant_member where tenant_id=$1 and user_id=$2 and not exists(select 1 from iam_binding where tenant_id=$1 and user_id=$2)',[tid,mailbox.owner_user_id]);
    await audit(db,{tenantId:tid,actorId,action:'mailbox.delete',resource:mailboxResource(tid,mid)});
  });
  return c.json({done:true});
});

tenants.put('/tenants/:tid/mailboxes/:mid/access', async (c) => {
  const tid = tenantId(c.req.param('tid')); const mid = tenantId(c.req.param('mid')); const actorId = c.get('session').user.id;
  const input = await body(c, z.object({ userId: z.string().min(1).max(128), role: z.enum(['roles/mailUser', 'roles/mailReader']).nullable() }).strict());
  await transaction(async (db) => {
    const resource = await resolveResource(mailboxResource(tid,mid),tid,db);
    await authorize(actorId,'iam.policy.set',resource,db);
    if (!await one('select 1 from tenant_member where tenant_id=$1 and user_id=$2',[tid,input.userId],db)) throw new IamError(404,'NOT_FOUND','Invite this person to the workspace first.');
    const direct = await query<{ role: string }>("select role from iam_binding where resource=$1 and user_id=$2 and role in ('roles/mailUser','roles/mailReader')",[resource.name,input.userId],db);
    for (const b of direct) await assertCanChange(db,actorId,resource,b.role,'revoke',input.userId);
    if (input.role) await assertCanChange(db,actorId,resource,input.role,'grant',input.userId);
    for (const b of direct) await revoke(db,resource.name,b.role,input.userId);
    if (input.role) await grant(db,tid,resource.name,input.role,input.userId,actorId);
    if (input.role) {
      await db.query('update mailbox set owner_user_id=$2 where id=$1 and not shared and owner_user_id is null',[mid,input.userId]);
      await db.query('insert into login_alias(address,user_id,mailbox_id) select address,owner_user_id,id from mailbox where id=$1 and not shared and owner_user_id=$2 on conflict do nothing',[mid,input.userId]);
    }
    await audit(db,{tenantId:tid,actorId,action:'mailbox.access',resource:resource.name,metadata:{userId:input.userId,role:input.role}});
  });
  return c.json({ok:true});
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
      emailInvite: z.boolean().default(false),
      newMailbox: z.object({
        localPart: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/),
        domainId: uuid,
        displayName: z.string().trim().max(80).default(''),
      }).optional(),
      role: z.string(),
      resource: z.string().optional(),
    }),
  );

  const result = await transaction(async (db) => {
    await authorize(user.id, 'members.invite', tenantOf(id), db);
    await db.query('select id from tenant where id=$1 for update',[id]);
    const recent = await one<{n:number}>("select count(*)::int as n from invite where tenant_id=$1 and created_at>now()-interval '1 hour'",[id],db);
    if ((recent?.n ?? 0)>=100) throw new IamError(429,'INVITE_LIMIT','This workspace reached 100 invitations per hour. Try later.');
    let createdMailbox: { id:string; address:string } | null = null;
    if (input.newMailbox) {
      if (input.resource || input.role !== 'roles/mailUser') throw new IamError(400, 'INVALID_ARGUMENT', 'A new work address receives Mail user access to its own mailbox.');
      await authorize(user.id, 'mailboxes.create', tenantOf(id), db);
      // Validate the grant before creating any registry entries.
      await assertCanGrantRole(db, user.id, tenantOf(id), input.role, input.email === user.email.toLowerCase());
      const domain = await one<{name:string;verified_at:Date|null}>('select name,verified_at from domain where id=$1 and tenant_id=$2', [input.newMailbox.domainId,id], db);
      if (!domain?.verified_at) throw new IamError(409, 'DOMAIN_NOT_READY', 'Finish Email setup for this domain first.');
      const address = `${input.newMailbox.localPart}@${domain.name}`;
      if(await one('select 1 from mailbox where address=$1',[address],db)) throw new IamError(409,'MAILBOX_EXISTS','This work address already exists. Select it under Existing access instead.');
      if(await one('select 1 from "user" where lower(email)=lower($1)',[address],db)) throw new IamError(409,'WORK_LOGIN_EXISTS','This work address already has a Sendraa login. Choose another address or resolve its existing account first.');
      createdMailbox = await one<{id:string;address:string}>(`insert into mailbox(tenant_id,domain_id,address,display_name,shared) values($1,$2,$3,$4,false) on conflict(address) do nothing returning id,address`, [id,input.newMailbox.domainId,address,input.newMailbox.displayName], db);
      if (!createdMailbox) throw new IamError(409, 'MAILBOX_EXISTS', 'This work address already exists. Select it under Existing access instead.');
      await audit(db, {tenantId:id,actorId:user.id,action:'mailbox.create',metadata:{address}});
    }
    const resource = await resolveResource(createdMailbox ? `tenants/${id}/mailboxes/${createdMailbox.id}` : input.resource ?? tenantResource(id), id, db);
    const self = input.email === user.email.toLowerCase();
    await assertCanGrantRole(db, user.id, resource, input.role, self);

    const open = await one<{ n: number }>('select count(*)::int as n from invite where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()', [id], db);
    if ((open?.n ?? 0) >= env.MAX_OPEN_INVITES) {
      throw new IamError(409, 'TOO_MANY_INVITES', `This workspace has ${env.MAX_OPEN_INVITES} open invites. Revoke some before sending more.`);
    }
    // Replace only the same invitation; one personal inbox may receive several work accounts.
    await db.query('update invite set revoked_at = now() where tenant_id = $1 and email = $2 and resource=$3 and accepted_at is null and revoked_at is null', [id, input.email,resource.name]);

    const token = newToken();
    const invite = await one<{ id: string; expires_at: Date }>(
      `insert into invite (tenant_id, email, resource, role, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7)) returning id, expires_at`,
      [id, input.email, resource.name, input.role, hashToken(token), user.id, env.INVITE_TTL_DAYS],
      db,
    );
    await audit(db, { tenantId: id, actorId: user.id, action: 'invite.create', resource: resource.name, metadata: { email: input.email, role: input.role } });
    return { ...invite!, token, mailbox:createdMailbox };
  });

  const inviteUrl = `${env.APP_SCHEME}://invite/${result.token}`;
  let activationError: string | null = null;
  if (result.mailbox) {
    try { await syncMailbox(id,result.mailbox.id); } catch { activationError = 'Work address created. Retry activation in Manage mailboxes before receiving mail.'; }
  }
  const provider = result.mailbox ? await one<{provider:string}>('select provider from sending_config where tenant_id=$1',[id]) : null;
  const sendingNotice = provider?.provider === 'gmail' ? 'Before the new work address can send, verify it in Gmail Send mail as and enable it in Sending settings.' : null;
  const webUrl = `${env.BETTER_AUTH_URL}/invite/${result.token}`;
  const delivery = input.emailInvite ? await deliverInvite(id,user.id,result.id,input.email,webUrl) : { emailSent:false,deliveryError:null };
  // The raw token is only exposed in the invite link, never persisted.
  return c.json(
    {
      id: result.id,
      expiresAt: result.expires_at,
      inviteUrl,
      ...delivery,
      mailbox: result.mailbox,
      activationError,
      sendingNotice,
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
// Setup (F2 + F3): connect a Cloudflare domain and build the mail system
// ---------------------------------------------------------------------------

tenants.get('/tenants/:tid/setup', async (c) => {
  const id = tenantId(c.req.param('tid'));
  await authorize(c.get('session').user.id, 'domains.list', tenantOf(id));
  const t = await one<{ setup_status: string; setup_error: string | null; worker_url: string | null; worker_version: string | null; cloudflare_account_id: string | null; cloudflare_account_name: string | null }>(
    'select setup_status, setup_error, worker_url, worker_version, cloudflare_account_id, cloudflare_account_name from tenant where id = $1',
    [id],
  );
  const rows = await query<{ step: string; status: string; error: string | null }>('select step, status, error from provision_step where tenant_id = $1', [id]);
  const domain = await one<{ name: string; zone_id: string | null; routing_enabled_at: Date | null }>(
    'select name, zone_id, routing_enabled_at from domain where tenant_id = $1 and zone_id is not null order by created_at limit 1',
    [id],
  );
  return c.json({
    status: t?.setup_status,
    error: t?.setup_error,
    workerUrl: t?.worker_url,
    workerVersion: t?.worker_version,
    updateAvailable: t?.worker_version !== (await loadArtifact()).version,
    cloudflareAccount: t?.cloudflare_account_name,
    cloudflareAccountId: t?.cloudflare_account_id,
    domain,
    steps: STEPS.map((s) => {
      const r = rows.find((x) => x.step === s.id);
      return { id: s.id, title: s.title, status: r?.status ?? 'pending', error: r?.error ?? null };
    }),
  });
});

tenants.post('/tenants/:tid/setup', async (c) => {
  const id = tenantId(c.req.param('tid'));
  const { user } = c.get('session');
  await authorize(user.id, 'domains.create', tenantOf(id));
  const input = await body(c, z.object({ zoneId: z.string().regex(/^[0-9a-f]{32}$/).optional() }));

  const t = await one<{ cloudflare_account_id: string | null; cloudflare_user_id: string | null; setup_status: string }>(
    'select cloudflare_account_id, cloudflare_user_id, setup_status from tenant where id = $1',
    [id],
  );
  if (!t?.cloudflare_account_id || !t.cloudflare_user_id) {
    throw new IamError(409, 'NO_CLOUDFLARE_ACCOUNT', 'This workspace is not linked to a Cloudflare account, so Sendraa cannot set it up.');
  }

  // Retry without a zone reuses the domain already chosen.
  let domain = await one<{ id: string; name: string; zone_id: string }>('select id, name, zone_id from domain where tenant_id = $1 and zone_id is not null order by created_at limit 1', [id]);
  if (input.zoneId && domain && domain.zone_id !== input.zoneId) {
    throw new IamError(409, 'DOMAIN_ALREADY_CONNECTED', `${domain.name} is already connected. Additional domains come later.`);
  }
  if (!domain) {
    if (!input.zoneId) throw new IamError(400, 'INVALID_ARGUMENT', 'Choose the domain to set up.');
    const cf = await cloudflareFor(t.cloudflare_user_id);
    const zone = (await cf.listZones(t.cloudflare_account_id).catch(cloudflareError)).find((z) => z.id === input.zoneId);
    if (!zone) throw new IamError(404, 'NOT_FOUND', 'That domain is not in the workspace’s Cloudflare account.');
    if (zone.status !== 'active') {
      throw new IamError(409, 'ZONE_NOT_ACTIVE', `${zone.name} is not active in Cloudflare yet (status: ${zone.status}). Point its nameservers at Cloudflare and wait for it to become active.`);
    }
    const taken = await one<{ tenant_id: string }>('select tenant_id from domain where name = $1', [zone.name]);
    if (taken && taken.tenant_id !== id) throw new IamError(409, 'DOMAIN_TAKEN', `${zone.name} is already connected to another workspace.`);
    domain = await transaction(async (db) => {
      const d = await one<{ id: string; name: string; zone_id: string }>(
        `insert into domain (tenant_id, name, zone_id) values ($1, $2, $3)
         on conflict (name) do update set zone_id = excluded.zone_id returning id, name, zone_id`,
        [id, zone.name, zone.id],
        db,
      );
      await audit(db, { tenantId: id, actorId: user.id, action: 'domain.connect', metadata: { name: zone.name, zoneId: zone.id } });
      return d!;
    });
  }

  if (!(await claimSetup(id))) return c.json({ status: 'running' }, 202);
  // Runs in the background; the app polls GET /setup for progress.
  void provision(id, domain.id, user.id, { workerOnly: t.setup_status === 'ready' });
  return c.json({ status: 'running', domain: domain.name }, 202);
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
