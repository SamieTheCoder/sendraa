import { one, query, type Queryable } from '../db.js';
import {
  ancestry,
  getRole,
  parseResource,
  tenantResource,
  type Permission,
  type ResourceName,
} from './roles.js';

export class IamError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Roles a user holds on a resource, including those inherited from its ancestors. */
export async function effectiveRoles(userId: string, resource: ResourceName, db?: Queryable): Promise<string[]> {
  const rows = await query<{ role: string }>(
    'select distinct role from iam_binding where user_id = $1 and tenant_id = $2 and resource = any($3)',
    [userId, resource.tenantId, ancestry(resource)],
    db,
  );
  return rows.map((r) => r.role);
}

export async function effectivePermissions(userId: string, resource: ResourceName, db?: Queryable): Promise<Set<Permission>> {
  const roles = await effectiveRoles(userId, resource, db);
  const perms = new Set<Permission>();
  for (const id of roles) for (const p of getRole(id)?.permissions ?? []) perms.add(p);
  if (resource.kind === 'mailbox') {
    const mailbox = await one<{ shared: boolean; owner_user_id: string | null; deleting_at: Date | null }>('select shared,owner_user_id,deleting_at from mailbox where id=$1 and tenant_id=$2', [resource.mailboxId, resource.tenantId], db);
    // Management roles never confer access to another person's messages.
    if (!mailbox || mailbox.deleting_at || (!mailbox.shared && mailbox.owner_user_id !== userId)) {
      for (const p of [...perms]) if (p.startsWith('mail.')) perms.delete(p);
    }
  }
  return perms;
}

/** Like Google's testIamPermissions: returns the subset of `wanted` the user holds. */
export async function testPermissions(userId: string, resource: ResourceName, wanted: readonly Permission[], db?: Queryable) {
  const held = await effectivePermissions(userId, resource, db);
  return wanted.filter((p) => held.has(p));
}

/**
 * Throws unless the user holds `permission` on `resource`.
 *
 * Callers outside the tenant get 404 rather than 403, so the API does not
 * confirm that a tenant or mailbox exists to someone with no access to it.
 */
export async function authorize(userId: string, permission: Permission, resource: ResourceName, db?: Queryable) {
  const held = await effectivePermissions(userId, resource, db);
  if (held.has(permission)) return;
  const member = await one('select 1 from tenant_member where tenant_id = $1 and user_id = $2', [resource.tenantId, userId], db);
  if (!member) throw new IamError(404, 'NOT_FOUND', 'Not found.');
  throw new IamError(403, 'PERMISSION_DENIED', `You need the ${permission} permission on ${resource.name}.`);
}

/** Resolves and validates a resource name that must belong to `tenantId`. */
export async function resolveResource(name: string, tenantId: string, db?: Queryable): Promise<ResourceName> {
  const resource = parseResource(name);
  if (!resource || resource.tenantId !== tenantId) {
    throw new IamError(400, 'INVALID_RESOURCE', 'Use tenants/<id> or tenants/<id>/mailboxes/<id> within this workspace.');
  }
  if (resource.kind === 'mailbox') {
    const exists = await one('select 1 from mailbox where id = $1 and tenant_id = $2', [resource.mailboxId, tenantId], db);
    if (!exists) throw new IamError(404, 'NOT_FOUND', 'Mailbox not found.');
  }
  return resource;
}

/**
 * Checks that `callerId` may give `role` to `targetUserId` on `resource`.
 * Used for direct grants and for invites, which are grants made in advance.
 *
 * Two rules on top of holding iam.policy.set:
 * - Management permissions (everything except mail.*) can only be granted by
 *   someone who already holds them there. Without this, a mailbox admin could
 *   make themselves Admin.
 * - Mail permissions can be granted to other people, which is what a mailbox
 *   admin is for, but not to yourself unless you already hold them. So nobody
 *   can quietly give themselves access to someone else's mail.
 * Owner can only be granted by an owner.
 */
export async function assertCanGrantRole(db: Queryable, callerId: string, resource: ResourceName, roleId: string, targetIsSelf: boolean) {
  await authorize(callerId, 'iam.policy.set', resource, db);

  const role = getRole(roleId);
  if (!role) throw new IamError(400, 'UNKNOWN_ROLE', `There is no role called ${roleId}.`);
  if (resource.kind === 'mailbox' && role.permissions.some((p) => p.startsWith('mail.'))) {
    const mailbox = await one<{ shared: boolean; owner_user_id: string | null; deleting_at: Date | null }>('select shared,owner_user_id,deleting_at from mailbox where id=$1 and tenant_id=$2 for update', [resource.mailboxId, resource.tenantId], db);
    if (mailbox?.deleting_at) throw new IamError(409, 'MAILBOX_DELETING', 'This mailbox is being deleted.');
    if (mailbox && !mailbox.shared && mailbox.owner_user_id) throw new IamError(403, 'PERSONAL_MAILBOX', 'Personal mail belongs only to its assigned user. Use a shared mailbox to delegate access.');
  }
  if (!role.grantableOn.includes(resource.kind)) {
    throw new IamError(400, 'ROLE_NOT_GRANTABLE', `${role.title} can only be granted on a ${role.grantableOn.join(' or ')}.`);
  }

  const held = await effectivePermissions(callerId, resource, db);
  const lacking = role.permissions.filter((p) => !held.has(p));
  const lackingManagement = lacking.filter((p) => !p.startsWith('mail.'));
  if (lackingManagement.length > 0 || (targetIsSelf && lacking.length > 0)) {
    throw new IamError(
      403,
      'ESCALATION_DENIED',
      targetIsSelf
        ? `You cannot give yourself ${role.title}, because it includes permissions you do not have.`
        : `You cannot grant ${role.title}, because it includes management permissions you do not have.`,
    );
  }

  if (roleId === 'roles/owner' && !(await effectiveRoles(callerId, resource, db)).includes('roles/owner')) {
    throw new IamError(403, 'OWNER_REQUIRED', 'Only an owner can grant Owner.');
  }
  return role;
}

/** Checks a direct grant or revoke before it is written. */
export async function assertCanChange(
  db: Queryable,
  callerId: string,
  resource: ResourceName,
  roleId: string,
  change: 'grant' | 'revoke',
  targetUserId: string,
) {
  await assertCanGrantRole(db, callerId, resource, roleId, change === 'grant' && targetUserId === callerId);

  const member = await one('select 1 from tenant_member where tenant_id = $1 and user_id = $2', [resource.tenantId, targetUserId], db);
  if (!member) throw new IamError(400, 'NOT_A_MEMBER', 'Invite this person to the workspace before granting them a role.');

  if (change === 'revoke' && roleId === 'roles/owner') await assertNotLastOwner(db, resource.tenantId, targetUserId);
}

export async function assertNotLastOwner(db: Queryable, tenantId: string, leavingUserId: string) {
  const owners = await query<{ user_id: string }>(
    "select user_id from iam_binding where tenant_id = $1 and resource = $2 and role = 'roles/owner'",
    [tenantId, tenantResource(tenantId)],
    db,
  );
  if (owners.length === 1 && owners[0]!.user_id === leavingUserId) {
    throw new IamError(409, 'LAST_OWNER', 'A workspace must keep at least one owner. Make someone else an owner first.');
  }
}

export async function grant(db: Queryable, tenantId: string, resource: string, role: string, userId: string, createdBy: string | null) {
  await db.query(
    `insert into iam_binding (tenant_id, resource, role, user_id, created_by)
     values ($1, $2, $3, $4, $5) on conflict (resource, role, user_id) do nothing`,
    [tenantId, resource, role, userId, createdBy],
  );
}

export async function revoke(db: Queryable, resource: string, role: string, userId: string) {
  const result = await db.query('delete from iam_binding where resource = $1 and role = $2 and user_id = $3', [resource, role, userId]);
  return (result as { rowCount?: number | null }).rowCount ?? 0;
}

export type PolicyBinding = { role: string; members: { userId: string; email: string; name: string }[] };

/** Bindings set directly on a resource, grouped by role like a Google IAM policy. */
export async function getPolicy(resource: string, db?: Queryable): Promise<PolicyBinding[]> {
  const rows = await query<{ role: string; user_id: string; email: string; name: string }>(
    `select b.role, b.user_id, u.email, u.name
       from iam_binding b join "user" u on u.id = b.user_id
      where b.resource = $1
      order by b.role, u.email`,
    [resource],
    db,
  );
  const byRole = new Map<string, PolicyBinding>();
  for (const r of rows) {
    const binding = byRole.get(r.role) ?? { role: r.role, members: [] };
    binding.members.push({ userId: r.user_id, email: r.email, name: r.name });
    byRole.set(r.role, binding);
  }
  return [...byRole.values()];
}
