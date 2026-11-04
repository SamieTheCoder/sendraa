import { createHash, randomBytes } from 'node:crypto';

import { one, type Queryable } from './db.js';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export type OpenInvite = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  resource: string;
  role: string;
  expires_at: Date;
  work_address: string | null;
  separate_account: boolean;
};

/** Finds an invite that can still be accepted. Expired, revoked and used invites return null. */
export async function findOpenInvite(token: string, db?: Queryable): Promise<OpenInvite | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return one<OpenInvite>(
    `select i.id, i.tenant_id, t.name as tenant_name, i.email, i.resource, i.role, i.expires_at,
            m.address as work_address, coalesce(not m.shared, false) as separate_account
       from invite i join tenant t on t.id = i.tenant_id
       left join mailbox m on m.tenant_id=i.tenant_id and i.resource='tenants/'||i.tenant_id||'/mailboxes/'||m.id
      where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
        and (i.resource not like '%/mailboxes/%' or (m.id is not null and m.deleting_at is null))`,
    [hashToken(token)],
    db,
  );
}
