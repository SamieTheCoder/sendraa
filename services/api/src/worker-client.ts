import { open } from './crypto.js';
import { one } from './db.js';
import { IamError } from './iam/policy.js';

export type WorkerTarget = { worker_url: string | null; worker_secret_enc: string | null };

/** One authenticated request to a tenant's mail Worker. */
export async function workerFetch(target: WorkerTarget, method: string, path: string, body?: unknown): Promise<Response> {
  if (!target.worker_url || !target.worker_secret_enc) throw new IamError(409, 'MAIL_NOT_READY', 'Email is not set up for this workspace yet.');
  return fetch(`${target.worker_url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${open(target.worker_secret_enc)}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function workerPutBytes(target: WorkerTarget, path: string, bytes: Uint8Array): Promise<void> {
  if (!target.worker_url || !target.worker_secret_enc) throw new Error('Worker unavailable');
  const response = await fetch(`${target.worker_url}${path}`, { method: 'PUT',
    headers: { authorization: `Bearer ${open(target.worker_secret_enc)}`, 'content-type': 'application/octet-stream' },
    body: new Uint8Array(bytes), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error('Worker upload failed');
}

/** The Worker of a tenant whose setup finished. */
export async function readyWorker(tenantId: string): Promise<WorkerTarget> {
  const t = await one<WorkerTarget & { setup_status: string }>('select worker_url, worker_secret_enc, setup_status from tenant where id = $1', [tenantId]);
  if (!t || t.setup_status !== 'ready' || !t.worker_url) {
    throw new IamError(409, 'MAIL_NOT_READY', 'Email is not set up for this workspace yet. An admin can finish it under Settings › Email setup.');
  }
  return t;
}
