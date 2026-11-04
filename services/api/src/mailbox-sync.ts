import { one, pool } from './db.js';
import { IamError } from './iam/policy.js';
import { readyWorker, workerFetch } from './worker-client.js';

/** Registry first, then idempotent Worker upsert. A failed sync is visible and retryable. */
export async function syncMailbox(tenantId: string, mailboxId: string) {
  const mailbox = await one<{ address: string; display_name: string }>(
    'select address, display_name from mailbox where tenant_id = $1 and id = $2 and deleting_at is null', [tenantId, mailboxId],
  );
  if (!mailbox) throw new IamError(404, 'NOT_FOUND', 'Mailbox not found.');
  const worker = await readyWorker(tenantId);
  const response = await workerFetch(worker, 'PUT', `/v1/mailboxes/${mailboxId}`, { address: mailbox.address, displayName: mailbox.display_name }).catch(() => null);
  if (!response?.ok) throw new IamError(502, 'MAILBOX_SYNC_FAILED', 'The mailbox was saved. Retry activation when your mail Worker is available.');
  await pool.query('update mailbox set synced_at = now() where id = $1 and tenant_id = $2', [mailboxId, tenantId]);
}
