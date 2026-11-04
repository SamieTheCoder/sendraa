import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Exercise the actual listening process with a disposable identity, never a real user's session.
const database = new URL(process.env.DATABASE_URL!);
if (!['localhost', '127.0.0.1'].includes(database.hostname)) throw new Error('Requires local development Postgres.');
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_ADMIN_SIGNUP = 'true';
process.env.CLOUDFLARE_CLIENT_ID = '';
process.env.CLOUDFLARE_CLIENT_SECRET = '';
const { auth } = await import('../src/auth.js');
const { pool } = await import('../src/db.js');
const email = `live-api-${randomUUID()}@example.invalid`;
let userId: string | undefined;
let tenantId: string | undefined;
try {
  const response = await auth.api.signUpEmail({ body: { email, name: 'Live API smoke test', password: randomUUID() }, asResponse: true });
  assert.equal(response.status, 200);
  userId = (await response.json()).user.id;
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  tenantId = (await pool.query('insert into tenant(name,created_by) values($1,$2) returning id', ['Live API smoke test',userId])).rows[0].id;
  await pool.query('insert into tenant_member(tenant_id,user_id) values($1,$2)',[tenantId,userId]);
  await pool.query('insert into iam_binding(tenant_id,resource,role,user_id) values($1,$2,$3,$4)',[tenantId,`tenants/${tenantId}`,'roles/owner',userId]);
  const origins = ['http://localhost:8787', new URL(process.env.BETTER_AUTH_URL!).origin];
  for (const origin of [...new Set(origins)]) {
    const request = (path: string) => fetch(`${origin}/v1/tenants/${tenantId}${path}`, { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
    const tenant = await request('');
    assert.equal(tenant.status, 200, 'Fixture session must reach its own workspace');
    const settings = await request('/sending');
    console.log(`${origin}: workspace ${tenant.status}, sending settings ${settings.status}`);
    assert.equal(settings.status, process.argv.includes('--expect-missing') ? 404 : 200);
    if (settings.ok) {
      assert.deepEqual(await settings.json(), { config: null });
      const mailboxes = await request('/mailboxes?manage=true');
      assert.equal(mailboxes.status, 200);
      const health = await fetch(`${origin}/health`).then((r)=>r.json()) as {capabilities:string[]};
      assert.ok(health.capabilities.includes('workspace-invites-v2') && health.capabilities.includes('push-notifications-v1'));
      const logo = await fetch(`${origin}/assets/sendraa-logo.png`);
      assert.equal(logo.status,200);assert.equal(logo.headers.get('content-type'),'image/png');
      const device=await fetch(`${origin}/v1/devices/${randomUUID()}`,{method:'DELETE',headers:{cookie}});
      assert.equal(device.status,200);
      console.log('PASS running API: sending, mailbox management, invitation logo, and authenticated device routes');
    }
  }
} finally {
  if (tenantId) await pool.query('delete from tenant where id=$1',[tenantId]);
  if (userId) await pool.query('delete from "user" where id=$1',[userId]);
  await pool.end();
}
