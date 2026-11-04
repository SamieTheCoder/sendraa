/**
 * Sendraa IAM, modelled on Google Cloud IAM.
 *
 * - A permission is `service.resource.verb`, the smallest grantable action.
 * - A role is a named bundle of permissions. Users never hold permissions
 *   directly, only roles.
 * - A binding grants one role to one user on one resource.
 * - Resources form a hierarchy, `tenants/<id>` above
 *   `tenants/<id>/mailboxes/<id>`. Bindings are inherited downwards, so a
 *   role on the tenant applies to management and shared mailboxes. Personal
 *   mailbox content additionally requires ownership, enforced by policy.ts.
 */

export const PERMISSIONS = [
  'tenant.get',
  'tenant.update',
  'tenant.delete',
  'domains.list',
  'domains.create',
  'domains.delete',
  'mailboxes.list',
  'mailboxes.create',
  'mailboxes.update',
  'mailboxes.delete',
  'mail.read',
  'mail.send',
  'mail.organize',
  'members.list',
  'members.invite',
  'members.remove',
  'iam.policy.get',
  'iam.policy.set',
  'sending.configure',
  'billing.manage',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type ResourceKind = 'tenant' | 'mailbox';

export type RoleDefinition = {
  id: string;
  title: string;
  description: string;
  /** Where the role may be granted. Mail roles make sense on one mailbox or a whole tenant. */
  grantableOn: ResourceKind[];
  permissions: readonly Permission[];
};

const ALL = PERMISSIONS;
const without = (...drop: Permission[]) => ALL.filter((p) => !drop.includes(p));

export const ROLES: readonly RoleDefinition[] = [
  {
    id: 'roles/owner',
    title: 'Owner',
    description: 'Full control, including deleting the workspace, billing and granting Owner.',
    grantableOn: ['tenant'],
    permissions: ALL,
  },
  {
    id: 'roles/admin',
    title: 'Admin',
    description: 'Manages domains, mailboxes, people, sending and access. Cannot delete the workspace or change billing.',
    grantableOn: ['tenant'],
    permissions: without('tenant.delete', 'billing.manage'),
  },
  {
    id: 'roles/mailboxAdmin',
    title: 'Mailbox admin',
    description: 'Creates and manages mailboxes and invites people to them. Cannot read mail unless also given a mail role.',
    grantableOn: ['tenant'],
    permissions: ['tenant.get', 'domains.list', 'mailboxes.list', 'mailboxes.create', 'mailboxes.update', 'mailboxes.delete', 'members.list', 'members.invite', 'iam.policy.get', 'iam.policy.set'],
  },
  {
    id: 'roles/billingAdmin',
    title: 'Billing admin',
    description: 'Manages the plan and payment details.',
    grantableOn: ['tenant'],
    permissions: ['tenant.get', 'billing.manage'],
  },
  {
    id: 'roles/auditor',
    title: 'Auditor',
    description: 'Reads settings, people, access and the audit log. Cannot read mail or change anything.',
    grantableOn: ['tenant'],
    permissions: ['tenant.get', 'domains.list', 'mailboxes.list', 'members.list', 'iam.policy.get', 'audit.read'],
  },
  {
    id: 'roles/mailUser',
    title: 'Mail user',
    description: 'Reads, sends and organizes mail in the mailbox.',
    grantableOn: ['mailbox', 'tenant'],
    permissions: ['tenant.get', 'mailboxes.list', 'mail.read', 'mail.send', 'mail.organize'],
  },
  {
    id: 'roles/mailReader',
    title: 'Mail reader',
    description: 'Reads mail in the mailbox. Cannot send or change it.',
    grantableOn: ['mailbox', 'tenant'],
    permissions: ['tenant.get', 'mailboxes.list', 'mail.read'],
  },
];

export function getRole(id: string): RoleDefinition | undefined {
  return ROLES.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Resource names
// ---------------------------------------------------------------------------

export type ResourceName =
  | { kind: 'tenant'; tenantId: string; name: string }
  | { kind: 'mailbox'; tenantId: string; mailboxId: string; name: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TENANT_RE = new RegExp(`^tenants/(${UUID})$`);
const MAILBOX_RE = new RegExp(`^tenants/(${UUID})/mailboxes/(${UUID})$`);

export const tenantResource = (tenantId: string) => `tenants/${tenantId}`;
export const mailboxResource = (tenantId: string, mailboxId: string) => `tenants/${tenantId}/mailboxes/${mailboxId}`;

export function parseResource(name: string): ResourceName | null {
  const m = MAILBOX_RE.exec(name);
  if (m) return { kind: 'mailbox', tenantId: m[1]!, mailboxId: m[2]!, name };
  const t = TENANT_RE.exec(name);
  if (t) return { kind: 'tenant', tenantId: t[1]!, name };
  return null;
}

/** The resource and every ancestor whose bindings apply to it, nearest first. */
export function ancestry(resource: ResourceName): string[] {
  return resource.kind === 'mailbox' ? [resource.name, tenantResource(resource.tenantId)] : [resource.name];
}
