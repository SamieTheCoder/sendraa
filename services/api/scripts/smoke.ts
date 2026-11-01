/**
 * End-to-end check of auth and IAM against a running API.
 *
 *   pnpm --filter @sendraa/api dev     # in one terminal, with ALLOW_DEV_ADMIN_SIGNUP=true
 *   pnpm --filter @sendraa/api smoke   # in another
 *
 * Creates throwaway users under a random suffix, so it can run repeatedly.
 */
const BASE = process.env.SMOKE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const run = Math.random().toString(36).slice(2, 8);
const domainName = `smoke-${run}.example`;

class Client {
  private cookies = new Map<string, string>();
  constructor(readonly label: string) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      this.cookies.set(pair!.slice(0, i), pair!.slice(i + 1));
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

async function acceptInvite(client: Client, inviteUrl: string, name: string) {
  const token = inviteUrl.split('/').pop()!;
  return client.call('POST', '/v1/invites/accept', { token, name, password: 'correct-horse-battery' });
}

async function main() {
  console.log(`smoke run ${run} against ${BASE}`);

  const owner = new Client('owner');
  const mbAdmin = new Client('mailbox admin');
  const member = new Client('member');
  const stranger = new Client('stranger');

  console.log('\nsign-up');
  const blocked = await stranger.call('POST', '/api/auth/sign-up/email', { email: `stranger-${run}@x.example`, password: 'correct-horse-battery', name: 'S' }, { 'x-sendraa-invite': 'not-a-real-token' });
  check('sign-up with a bad invite token is refused', blocked.status === 403, blocked);

  const ownerEmail = `owner-${run}@x.example`;
  const signUp = await owner.call('POST', '/api/auth/sign-up/email', { email: ownerEmail, password: 'correct-horse-battery', name: 'Olivia Owner' });
  check('dev admin can sign up', signUp.status === 200, signUp);

  const me = await owner.call('GET', '/v1/me');
  check('me returns the signed-in user', me.json?.user?.email === ownerEmail, me);

  const anon = await stranger.call('GET', '/v1/me');
  check('me without a session is 401', anon.status === 401, anon);

  console.log('\nworkspace');
  const tenant = await owner.call('POST', '/v1/tenants', { name: 'Smoke Labs' });
  check('owner creates a workspace', tenant.status === 201, tenant);
  const tid = tenant.json.id as string;

  const domain = await owner.call('POST', `/v1/tenants/${tid}/domains`, { name: domainName });
  check('owner adds a domain', domain.status === 201, domain);
  const badDomain = await owner.call('POST', `/v1/tenants/${tid}/domains`, { name: 'not a domain' });
  check('an invalid domain is rejected', badDomain.status === 400, badDomain);

  const box = await owner.call('POST', `/v1/tenants/${tid}/mailboxes`, { localPart: 'hello', domainId: domain.json.id, displayName: 'Hello', shared: true });
  check('owner creates hello@ mailbox', box.status === 201 && box.json.address === `hello@${domainName}`, box);
  const box2 = await owner.call('POST', `/v1/tenants/${tid}/mailboxes`, { localPart: 'ceo', domainId: domain.json.id });
  check('owner creates ceo@ mailbox', box2.status === 201, box2);
  const helloRes = `tenants/${tid}/mailboxes/${box.json.id}`;
  const ceoRes = `tenants/${tid}/mailboxes/${box2.json.id}`;

  console.log('\ninvites');
  const inv1 = await owner.call('POST', `/v1/tenants/${tid}/invites`, { email: `mbadmin-${run}@x.example`, role: 'roles/mailboxAdmin' });
  check('owner invites a mailbox admin', inv1.status === 201 && inv1.json.inviteUrl?.startsWith('sendraa://invite/'), inv1);
  const preview = await stranger.call('GET', `/v1/invites/${inv1.json.inviteUrl.split('/').pop()}`);
  check('invite preview shows workspace and role', preview.json?.workspace === 'Smoke Labs' && preview.json?.role === 'Mailbox admin', preview);
  const acc1 = await acceptInvite(mbAdmin, inv1.json.inviteUrl, 'Max Admin');
  check('mailbox admin accepts and is signed in', acc1.status === 200, acc1);
  const replay = await acceptInvite(stranger, inv1.json.inviteUrl, 'Replay');
  check('an invite cannot be used twice', replay.status === 404, replay);

  const inv2 = await owner.call('POST', `/v1/tenants/${tid}/invites`, { email: `member-${run}@x.example`, role: 'roles/mailUser', resource: helloRes });
  check('owner invites a member to hello@ only', inv2.status === 201, inv2);
  const acc2 = await acceptInvite(member, inv2.json.inviteUrl, 'Mia Member');
  check('member accepts', acc2.status === 200, acc2);

  console.log('\nmember access');
  const mine = await member.call('GET', `/v1/tenants/${tid}/mailboxes`);
  const addresses = (mine.json?.mailboxes ?? []).map((m: { address: string }) => m.address);
  check('member sees only hello@', addresses.length === 1 && addresses[0] === `hello@${domainName}`, mine);
  const canRead = await member.call('POST', `/v1/tenants/${tid}/iam:test`, { resource: helloRes, permissions: ['mail.read', 'mail.send', 'mailboxes.delete'] });
  check('member can read and send hello@ but not delete it', JSON.stringify(canRead.json?.permissions) === JSON.stringify(['mail.read', 'mail.send']), canRead);
  const ceoTest = await member.call('POST', `/v1/tenants/${tid}/iam:test`, { resource: ceoRes, permissions: ['mail.read'] });
  check('member cannot read ceo@', JSON.stringify(ceoTest.json?.permissions) === '[]', ceoTest);
  const memberInvite = await member.call('POST', `/v1/tenants/${tid}/invites`, { email: `x-${run}@x.example`, role: 'roles/mailUser' });
  check('member cannot invite people', memberInvite.status === 403, memberInvite);
  const strangerTenant = await stranger.call('GET', `/v1/tenants/${tid}`);
  check('outsider gets 401 without a session', strangerTenant.status === 401, strangerTenant);

  console.log('\nescalation rules');
  const mbAdminId = (await mbAdmin.call('GET', '/v1/me')).json.user.id as string;
  const memberId = (await member.call('GET', '/v1/me')).json.user.id as string;
  const ownerId = me.json.user.id as string;

  const grantCeo = await mbAdmin.call('POST', `/v1/tenants/${tid}/iam/bindings`, { resource: ceoRes, role: 'roles/mailUser', userId: memberId });
  check('mailbox admin can give the member access to ceo@', grantCeo.status === 201, grantCeo);
  const selfCeo = await mbAdmin.call('POST', `/v1/tenants/${tid}/iam/bindings`, { resource: ceoRes, role: 'roles/mailUser', userId: mbAdminId });
  check('mailbox admin cannot give themselves mail access', selfCeo.status === 403 && selfCeo.json?.error?.code === 'ESCALATION_DENIED', selfCeo);
  const selfAdmin = await mbAdmin.call('POST', `/v1/tenants/${tid}/iam/bindings`, { resource: `tenants/${tid}`, role: 'roles/admin', userId: mbAdminId });
  check('mailbox admin cannot make themselves Admin', selfAdmin.status === 403, selfAdmin);
  const inviteAdmin = await mbAdmin.call('POST', `/v1/tenants/${tid}/invites`, { email: `sneaky-${run}@x.example`, role: 'roles/admin' });
  check('mailbox admin cannot invite an Admin', inviteAdmin.status === 403, inviteAdmin);
  const wrongPlace = await owner.call('POST', `/v1/tenants/${tid}/iam/bindings`, { resource: helloRes, role: 'roles/admin', userId: memberId });
  check('Admin cannot be granted on a single mailbox', wrongPlace.status === 400, wrongPlace);
  const lastOwner = await owner.call('DELETE', `/v1/tenants/${tid}/iam/bindings`, { resource: `tenants/${tid}`, role: 'roles/owner', userId: ownerId });
  check('the last owner cannot be removed', lastOwner.status === 409, lastOwner);

  console.log('\npolicy and audit');
  const policy = await owner.call('GET', `/v1/tenants/${tid}/iam?resource=${encodeURIComponent(ceoRes)}`);
  check('policy for ceo@ lists the member as Mail user', policy.json?.bindings?.[0]?.role === 'roles/mailUser', policy);
  const auditLog = await owner.call('GET', `/v1/tenants/${tid}/audit`);
  check('audit log records the changes', (auditLog.json?.entries ?? []).length >= 7, auditLog.json?.entries?.length);
  const memberAudit = await member.call('GET', `/v1/tenants/${tid}/audit`);
  check('member cannot read the audit log', memberAudit.status === 403, memberAudit);

  const removed = await owner.call('DELETE', `/v1/tenants/${tid}/members/${memberId}`);
  check('owner removes the member', removed.status === 200, removed);
  const after = await member.call('GET', `/v1/tenants/${tid}/mailboxes`);
  check('removed member loses access', after.status === 404, after);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
