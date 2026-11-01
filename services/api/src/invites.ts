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
};

/** Finds an invite that can still be accepted. Expired, revoked and used invites return null. */
export async function findOpenInvite(token: string, db?: Queryable): Promise<OpenInvite | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return one<OpenInvite>(
    `select i.id, i.tenant_id, t.name as tenant_name, i.email, i.resource, i.role, i.expires_at
       from invite i join tenant t on t.id = i.tenant_id
      where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`,
    [hashToken(token)],
    db,
  );
}
