import { loadArtifact } from '@sendraa/mail-worker/artifact';
import { one, pool } from '../src/db.js';
import { claimSetup, provision } from '../src/provision.js';
import { workerFetch, type WorkerTarget } from '../src/worker-client.js';

// Explicit single-domain maintenance. Inspect by default; --apply updates only
// the existing D1 schema and Worker, preserving mail, storage, secrets, and DNS.
const domain = process.argv[2];
const apply = process.argv[3] === '--apply';
if (!domain || process.argv.length > 4 || (process.argv[3] && !apply)) {
  throw new Error('Usage: pnpm exec tsx --env-file=.env scripts/update-mail-worker.ts <domain> [--apply]');
}
try {
  const tenant = await one<WorkerTarget & { id: string; domain_id: string; cloudflare_user_id: string; worker_version: string; setup_status: string }>(
    `select t.id, d.id as domain_id, t.cloudflare_user_id, t.worker_version, t.setup_status, t.worker_url, t.worker_secret_enc
     from tenant t join domain d on d.tenant_id=t.id where d.name=$1`, [domain.toLowerCase()],
  );
  if (!tenant) throw new Error('No workspace found for this domain.');
  const artifact = await loadArtifact();
  const before = await workerFetch(tenant, 'GET', '/v1/health');
  if (!before.ok) throw new Error(`Existing Worker health failed (${before.status}).`);
  console.log(JSON.stringify({ domain, worker: tenant.worker_url, deployed: tenant.worker_version, target: artifact.version, health: await before.json() }));
  if (apply) {
    if (tenant.setup_status !== 'ready') throw new Error('Workspace must be ready. Use Email setup to resume a failed setup.');
    if (!await claimSetup(tenant.id)) throw new Error('Another setup is already running.');
    await provision(tenant.id, tenant.domain_id, tenant.cloudflare_user_id, { workerOnly: true });
    const result = await one<{ setup_status: string; setup_error: string | null; worker_version: string }>(
      'select setup_status, setup_error, worker_version from tenant where id=$1', [tenant.id],
    );
    if (result?.setup_status !== 'ready' || result.setup_error) throw new Error(result?.setup_error ?? 'Worker update failed.');
    const after = await workerFetch(tenant, 'GET', '/v1/health');
    if (!after.ok) throw new Error(`Updated Worker health failed (${after.status}).`);
    console.log(JSON.stringify({ domain, deployed: result.worker_version, health: await after.json() }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Worker maintenance failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
