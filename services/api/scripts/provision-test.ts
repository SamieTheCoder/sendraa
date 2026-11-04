import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import { CloudflareApi } from '@sendraa/cloudflare';
import { loadArtifact } from '@sendraa/mail-worker/artifact';

const database = new URL(process.env.DATABASE_URL!);
if (!['localhost', '127.0.0.1'].includes(database.hostname)) throw new Error('Tests require local Postgres.');
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_ADMIN_SIGNUP = 'true';
process.env.CLOUDFLARE_CLIENT_ID = '';
process.env.CLOUDFLARE_CLIENT_SECRET = '';
const { auth } = await import('../src/auth.js');
const { pool } = await import('../src/db.js');
const { seal } = await import('../src/crypto.js');
const { STEPS, claimSetup, provision } = await import('../src/provision.js');
const artifact = await loadArtifact();
const originalFetch = globalThis.fetch;
const originalToken = auth.api.getAccessToken;
(auth.api as { getAccessToken: unknown }).getAccessToken = async () => ({ accessToken: 'fixture-token' });
let healthChecks = 0;
let staleHealth = false;
let schemas = 0;
let uploads = 0;
let dnsCalls = 0;
let tenantId: string | undefined;
let userId: string | undefined;
const secret = 'fixture-existing-secret';
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://worker.test', 'No external requests allowed');
  assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${secret}`);
  if (url.pathname === '/v1/health') {
    healthChecks++;
    return Response.json(staleHealth ? { ok: true, version: '0.1.0' } : { ok: true, version: artifact.version.split('+')[0], capabilities: ['outbound'] });
  }
  assert.match(url.pathname, /^\/v1\/mailboxes\//);
  return Response.json({ ok: true });
};
mock.method(CloudflareApi.prototype, 'queryD1', async (_account: string, databaseId: string) => {
  assert.equal(databaseId, 'existing-d1'); schemas++; return [];
});
mock.method(CloudflareApi.prototype, 'uploadWorker', async (_account: string, name: string, script: string, options: { bindings: { name: string; text?: string; database_id?: string }[] }) => {
  assert.equal(name, artifact.name); assert.equal(script, artifact.script);
  assert.equal(options.bindings.find((b) => b.name === 'DB')?.database_id, 'existing-d1');
  assert.equal(options.bindings.find((b) => b.name === 'TENANT_SECRET')?.text, secret);
  uploads++;
});
mock.method(CloudflareApi.prototype, 'getEmailRouting', async () => { dnsCalls++; return { enabled: true }; });
mock.method(CloudflareApi.prototype, 'listDnsRecords', async () => [{ content: 'v=DMARC1; p=none' }]);
mock.method(CloudflareApi.prototype, 'setCatchAllToWorker', async () => { dnsCalls++; });
try {
  const user = await auth.api.signUpEmail({ body: { name: 'Upgrade test', email: `${randomUUID()}@example.invalid`, password: randomUUID() } });
  userId = user.user.id;
  tenantId = (await pool.query(`insert into tenant(name,created_by,setup_status,worker_url,worker_secret_enc,d1_database_id,cloudflare_account_id,cloudflare_user_id)
    values($1,$2,'ready','https://worker.test',$3,'existing-d1',$4,$2) returning id`, ['Upgrade test', userId, seal(secret), 'a'.repeat(32)])).rows[0].id;
  await pool.query('insert into account(id,"accountId","providerId","userId","createdAt","updatedAt") values($1,$2,$3,$4,now(),now())', [randomUUID(), 'fixture-cloudflare', 'cloudflare', userId]);
  const domain = (await pool.query('insert into domain(tenant_id,name,zone_id) values($1,$2,$3) returning id', [tenantId, `${randomUUID()}.invalid`, 'b'.repeat(32)])).rows[0].id;
  for (const step of STEPS) await pool.query("insert into provision_step(tenant_id,step,status,detail) values($1,$2,'done',$3)", [tenantId, step.id, JSON.stringify({ version: '0.1.0+legacy' })]);

  assert.equal(await claimSetup(tenantId!), true);
  assert.equal(await claimSetup(tenantId!), false, 'Concurrent setup cannot claim the workspace twice');
  await provision(tenantId!, domain, userId!);
  assert.equal(schemas, artifact.migrations.length, 'Normal setup reapplies schema for an upgrade');
  assert.equal(uploads, 1, 'Normal setup deploys changed Worker');
  assert.equal(healthChecks, 1, 'Normal setup checks deployment even if the old check was done');
  console.log('PASS normal upgrade migrates schema, deploys Worker, preserves bindings and checks health');

  dnsCalls = 0;
  assert.equal(await claimSetup(tenantId!), true);
  await provision(tenantId!, domain, userId!, { workerOnly: true });
  assert.equal(dnsCalls, 0, 'Targeted upgrade does not touch routing or DNS');
  assert.equal(uploads, 2, 'Targeted repair redeploys even if the stored version matches');
  assert.equal(healthChecks, 2);
  console.log('PASS targeted repair preserves DNS and can repair a drifted deployment');

  staleHealth = true;
  assert.equal(await claimSetup(tenantId!), true);
  await provision(tenantId!, domain, userId!, { workerOnly: true });
  const state = (await pool.query('select setup_status,setup_error from tenant where id=$1', [tenantId])).rows[0];
  assert.equal(state.setup_status, 'ready', 'A failed upgrade must preserve a healthy existing inbox');
  assert.match(state.setup_error, /not ready for sending/);
  console.log('PASS a healthy old Worker cannot falsely mark an upgrade successful');
} finally {
  globalThis.fetch = originalFetch;
  (auth.api as { getAccessToken: unknown }).getAccessToken = originalToken;
  mock.restoreAll();
  if (tenantId) await pool.query('delete from tenant where id=$1', [tenantId]);
  if (userId) await pool.query('delete from "user" where id=$1', [userId]);
  await pool.end();
}
