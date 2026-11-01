/**
 * End-to-end check of the mail path without a Cloudflare account:
 * app → API (session + IAM) → tenant Worker (wrangler dev) → D1/R2.
 *
 *   1. cd workers/sendraa-mail && npx wrangler dev        (port 8788, .dev.vars)
 *   2. cd services/api && pnpm mail:e2e
 *
 * The workspace is pointed at the local Worker directly in the database, which
 * stands in for setup having finished.
 */
import { seal } from '../src/crypto.js';
import { pool } from '../src/db.js';
import { workerFetch } from '../src/worker-client.js';

const API = process.env.SMOKE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const WORKER = process.env.WORKER_URL ?? 'http://localhost:8788';
const WORKER_SECRET = process.env.WORKER_SECRET ?? 'local-dev-secret-change-me-0123456789';
const run = Math.random().toString(36).slice(2, 8);
const domain = `e2e-${run}.example`;

class Client {
  cookies = new Map<string, string>();
  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: API, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
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
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`);
};

async function deliver(to: string, raw: string) {
  const res = await fetch(`${WORKER}/cdn-cgi/local/email?from=alice%40example.com&to=${encodeURIComponent(to)}`, { method: 'POST', body: raw });
  return res.status;
}

async function main() {
  console.log(`mail e2e ${run}: API ${API}, Worker ${WORKER}`);
  const owner = new Client();
  const outsider = new Client();

  await owner.call('POST', '/api/auth/sign-up/email', { email: `owner-${run}@x.example`, password: 'correct-horse-battery', name: 'Owner' });
  const t = await owner.call('POST', '/v1/tenants', { name: 'E2E Labs' });
  const tid = t.json.id as string;
  const d = await owner.call('POST', `/v1/tenants/${tid}/domains`, { name: domain });
  const mb = await owner.call('POST', `/v1/tenants/${tid}/mailboxes`, { localPart: 'admin', domainId: d.json.id, displayName: 'Admin' });
  const mid = mb.json.id as string;
  check('workspace, domain and admin@ mailbox exist', t.status === 201 && d.status === 201 && mb.status === 201, { t, d, mb });

  const before = await owner.call('GET', `/v1/tenants/${tid}/mailboxes/${mid}/threads`);
  check('mail is refused before setup finishes', before.status === 409 && before.json?.error?.code === 'MAIL_NOT_READY', before);

  // Stand-in for F3 having completed against this Worker.
  await pool.query(`update tenant set worker_url = $2, worker_secret_enc = $3, setup_status = 'ready' where id = $1`, [tid, WORKER, seal(WORKER_SECRET)]);
  const put = await workerFetch({ worker_url: WORKER, worker_secret_enc: seal(WORKER_SECRET) }, 'PUT', `/v1/mailboxes/${mid}`, { address: `admin@${domain}`, displayName: 'Admin' });
  check('mailbox registered in the Worker', put.ok, put.status);

  const status = await deliver(
    `admin@${domain}`,
    [
      'From: "Alice" <alice@example.com>',
      `To: admin@${domain}`,
      'Subject: Hello from the pipeline',
      `Message-ID: <e2e-${run}@example.com>`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'This came through email(), D1 and R2.',
      '--b',
      'Content-Type: text/plain; name="notes.txt"',
      'Content-Disposition: attachment; filename="notes.txt"',
      '',
      'attachment body',
      '--b--',
      '',
    ].join('\r\n'),
  );
  check('Worker accepts the email', status === 200, status);

  const list = await owner.call('GET', `/v1/tenants/${tid}/mailboxes/${mid}/threads`);
  const thread = list.json?.threads?.[0];
  check('inbox lists the thread through the API', list.status === 200 && thread?.subject === 'Hello from the pipeline', list);

  const full = await owner.call('GET', `/v1/tenants/${tid}/mailboxes/${mid}/threads/${thread?.id}`);
  const att = full.json?.messages?.[0]?.attachments?.[0];
  check('thread has the body and attachment', full.json?.messages?.[0]?.text?.includes('D1 and R2') && att?.name === 'notes.txt', full);

  const file = await fetch(`${API}/v1/tenants/${tid}/mailboxes/${mid}/attachments/${att?.id}`, {
    headers: { cookie: [...owner.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  check('attachment downloads through the API', file.ok && (await file.text()) === 'attachment body', file.status);

  const star = await owner.call('PATCH', `/v1/tenants/${tid}/mailboxes/${mid}/threads/${thread?.id}`, { starred: true, unread: false });
  check('star and mark read', star.status === 200 && star.json.starred === true && star.json.unread === false, star);

  const bad = await owner.call('PATCH', `/v1/tenants/${tid}/mailboxes/${mid}/threads/${thread?.id}`, { location: 'nowhere' });
  check('invalid update is rejected', bad.status === 400, bad);

  await outsider.call('POST', '/api/auth/sign-up/email', { email: `out-${run}@x.example`, password: 'correct-horse-battery', name: 'Out' });
  const peek = await outsider.call('GET', `/v1/tenants/${tid}/mailboxes/${mid}/threads`);
  check('an outsider cannot read the mailbox', peek.status === 404, peek);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
