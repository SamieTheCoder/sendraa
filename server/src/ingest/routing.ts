import { sql } from '../db/index.js';
import { splitAddress } from '../lib/addresses.js';

export interface ResolvedRecipient {
  mailboxId: string;
  tenantId: string;
  domainId: string;
  address: string;
  tag: string | null;
}

/**
 * Resolves an envelope recipient to a mailbox we actually host.
 *
 * Returning null means we must reject at RCPT TO. Accepting mail we cannot
 * deliver would make us generate backscatter to forged senders, which is the
 * fastest way for a new MX to get blacklisted.
 */
export async function resolveRecipient(address: string): Promise<ResolvedRecipient | null> {
  const parts = splitAddress(address);
  if (!parts) return null;

  const rows = await sql<
    { mailbox_id: string; tenant_id: string; domain_id: string }[]
  >`
    select
      coalesce(mb.id, d.catch_all_mailbox) as mailbox_id,
      d.tenant_id                          as tenant_id,
      d.id                                 as domain_id
    from domains d
    left join mailboxes mb
      on mb.domain_id = d.id
     and mb.local_part = ${parts.baseLocalPart}
    where d.domain = ${parts.domain}
      and d.verified_at is not null
    limit 1
  `;

  const row = rows[0];
  if (!row?.mailbox_id) return null;

  return {
    mailboxId: row.mailbox_id,
    tenantId: row.tenant_id,
    domainId: row.domain_id,
    address: `${parts.localPart}@${parts.domain}`,
    tag: parts.tag,
  };
}

/** Checks a sender against the mailbox blocklist. Patterns are exact addresses or `@domain`. */
export async function isBlocked(mailboxId: string, from: string): Promise<boolean> {
  const parts = splitAddress(from);
  if (!parts) return false;

  const rows = await sql<{ exists: boolean }[]>`
    select true as exists
    from blocklist
    where mailbox_id = ${mailboxId}
      and pattern in (${parts.localPart + '@' + parts.domain}, ${'@' + parts.domain})
    limit 1
  `;
  return rows.length > 0;
}
