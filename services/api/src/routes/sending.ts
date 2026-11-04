import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { CloudflareApiError } from '@sendraa/cloudflare';
import { cloudflareFor } from '../cloudflare.js';
import { open, seal } from '../crypto.js';
import { audit, one, pool, query, transaction } from '../db.js';
import { env } from '../env.js';
import { body, requireSession, uuid, type AppEnv } from '../http.js';
import { authorize, IamError, resolveResource } from '../iam/policy.js';
import { mailboxResource, tenantResource } from '../iam/roles.js';
import { syncMailbox } from '../mailbox-sync.js';
import { DeliveryError, gmailTransport, MAX_MESSAGE_BYTES, rawMessage, sendCloudflare, sendGmail, sendInput, type DeliveryResult, type Outbound } from '../sending-provider.js';
import { readyWorker, workerFetch, workerPutBytes } from '../worker-client.js';

export const sending = new Hono<AppEnv>();
sending.use('*', requireSession);
sending.use('*', bodyLimit({ maxSize: 36 * 1024 * 1024, onError: (c) => c.json({ error: { code: 'TOO_LARGE', message: 'Message exceeds the 25 MiB limit after encoding.' } }, 413) }));
const tenant = (id: string) => ({ kind: 'tenant' as const, tenantId: id, name: tenantResource(id) });
const id = (value: string) => { const result = uuid.safeParse(value); if (!result.success) throw new IamError(404, 'NOT_FOUND', 'Not found.'); return result.data; };
type Config = { provider: 'cloudflare' | 'gmail'; credentials_enc: string | null; gmail_user: string | null; allowed_from: string[] };
type Tenant = { cloudflare_account_id: string | null; cloudflare_user_id: string | null };
const configInput = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('cloudflare') }).strict(),
  z.object({ provider: z.literal('gmail'), user: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().max(128).transform((s) => s.replace(/\s/g, '')).pipe(z.string().refine((s) => !s || /^[a-zA-Z0-9]{16}$/.test(s), 'Enter the 16-character Google app password. Spaces are ignored.')).optional(),
    allowedFrom: z.array(z.email()).max(200) }).strict(),
]);

sending.get('/tenants/:tid/sending', async (c) => {
  const tid = id(c.req.param('tid'));
  await authorize(c.get('session').user.id, 'sending.configure', tenant(tid));
  return c.json({ config: await one('select provider, gmail_user, allowed_from, default_mailbox_id, verified_at, (credentials_enc is not null) as "hasPassword" from sending_config where tenant_id = $1', [tid]) });
});

sending.put('/tenants/:tid/sending/default', async (c) => {
  const tid = id(c.req.param('tid'));
  const actorId = c.get('session').user.id;
  await authorize(actorId, 'sending.configure', tenant(tid));
  const input = await body(c, z.object({ mailboxId: uuid }).strict());
  await transaction(async (db) => {
    const config = await one<Config>('select * from sending_config where tenant_id=$1 for update', [tid], db);
    if (!config) throw new IamError(409, 'SENDING_NOT_CONFIGURED', 'Configure sending first.');
    const mailbox = await one<{address:string;shared:boolean;owner_user_id:string|null}>('select address,shared,owner_user_id from mailbox where id=$1 and tenant_id=$2 and deleting_at is null', [input.mailboxId,tid], db);
    if (!mailbox) throw new IamError(404, 'NOT_FOUND', 'Mailbox not found.');
    if (!mailbox.shared && mailbox.owner_user_id !== actorId) throw new IamError(403,'PERSONAL_MAILBOX','Another person’s private mailbox cannot be used as the workspace sender.');
    if (config.provider === 'gmail' && !config.allowed_from.includes(mailbox.address)) throw new IamError(400, 'ALIAS_REQUIRED', 'Enable this verified Gmail sender address first.');
    await db.query('update sending_config set default_mailbox_id=$2 where tenant_id=$1', [tid,input.mailboxId]);
    await audit(db, {tenantId:tid,actorId,action:'sending.default',metadata:{mailboxId:input.mailboxId}});
  });
  return c.json({ok:true});
});

sending.put('/tenants/:tid/sending', async (c) => {
  const tid = id(c.req.param('tid')); const actorId = c.get('session').user.id;
  await authorize(actorId, 'sending.configure', tenant(tid));
  const input = await body(c, configInput);
  let credentialsEnc: string | null = null;
  if (input.provider === 'gmail') {
    const existing = await one<Config>('select * from sending_config where tenant_id=$1', [tid]);
    const reusePassword = existing?.provider === 'gmail' && existing.gmail_user?.toLowerCase() === input.user && existing.credentials_enc;
    if (!input.password && !reusePassword) throw new IamError(400, 'GMAIL_PASSWORD_REQUIRED', 'Enter an app password for this Google account.');
    credentialsEnc = input.password ? seal(input.password) : existing!.credentials_enc;
    const mailboxes = await query<{ address: string }>('select address from mailbox where tenant_id = $1', [tid]);
    if (input.allowedFrom.some((a) => !mailboxes.some((m) => m.address.toLowerCase() === a.toLowerCase()))) throw new IamError(400, 'INVALID_ALIAS', 'Only workspace mailbox addresses can be sending aliases.');
    const smtp = gmailTransport(input.user, open(credentialsEnc!));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([smtp.verify(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Verification timed out'), { code: 'ETIMEDOUT' })), 25_000);
      })]);
    } catch (err) {
      const failure = err as { code?: string; responseCode?: number };
      if (failure.code === 'EAUTH' || failure.responseCode === 535 || failure.responseCode === 534) {
        throw new IamError(400, 'GMAIL_AUTH_FAILED', 'Google rejected the email or app password. Use an app password from this exact Google account, with 2-Step Verification enabled—not your normal Google password.');
      }
      throw new IamError(502, 'GMAIL_UNAVAILABLE', 'The server could not connect to Gmail to verify your credentials. Your changes have not been saved. Try again; if it continues, check the server’s outbound SMTP connection on port 587.');
    } finally { clearTimeout(timer); smtp.close(); }
  } else {
    await readyWorker(tid);
    const t = await one<Tenant>('select cloudflare_account_id, cloudflare_user_id from tenant where id = $1', [tid]);
    if (!t?.cloudflare_user_id || !t.cloudflare_account_id) throw new IamError(409, 'CLOUDFLARE_REQUIRED', 'Connect this workspace to Cloudflare first.');
    const domains = await query<{ name: string; zone_id: string | null }>('select name, zone_id from domain where tenant_id = $1', [tid]);
    if (!domains.length) throw new IamError(409, 'DOMAIN_REQUIRED', 'Finish email setup first.');
    const cf = await cloudflareFor(t.cloudflare_user_id);
    try {
      for (const d of domains) {
        if (!d.zone_id) throw new IamError(409, 'DOMAIN_REQUIRED', `Finish setup for ${d.name} first.`);
        const schema = z.array(z.object({ name: z.string(), enabled: z.boolean() }));
        let list = schema.parse(await cf.get(`/zones/${d.zone_id}/email/sending/subdomains`));
        if (!list.some((s) => s.name === d.name)) {
          await cf.post(`/zones/${d.zone_id}/email/sending/subdomains`, { name: d.name });
          list = schema.parse(await cf.get(`/zones/${d.zone_id}/email/sending/subdomains`));
        }
        if (!list.some((s) => s.name === d.name && s.enabled)) throw new IamError(409, 'DOMAIN_NOT_READY', `Activate ${d.name} and complete its DNS verification in Cloudflare Email Sending, then retry.`);
      }
    } catch (err) {
      if (err instanceof IamError) throw err;
      if (err instanceof CloudflareApiError) throw new IamError(err.notEntitled ? 409 : 403, err.notEntitled ? 'NOT_ENTITLED' : 'CLOUDFLARE_PERMISSION', err.notEntitled
        ? 'Cloudflare Email Sending is not enabled for this account. Enable it in Cloudflare or choose Gmail.'
        : 'Cloudflare did not allow sending setup. Reconnect with Email Sending permissions; this is not an entitlement check result.');
      throw new IamError(502, 'CLOUDFLARE_UNAVAILABLE', 'Could not verify Cloudflare sending. Try again.');
    }
  }
  await transaction(async (db) => {
    await db.query(`insert into sending_config(tenant_id, provider, credentials_enc, gmail_user, allowed_from) values ($1,$2,$3,$4,$5)
      on conflict(tenant_id) do update set provider=excluded.provider, credentials_enc=excluded.credentials_enc, gmail_user=excluded.gmail_user, allowed_from=excluded.allowed_from, verified_at=now()`,
    [tid, input.provider, credentialsEnc, input.provider === 'gmail' ? input.user : null, JSON.stringify(input.provider === 'gmail' ? input.allowedFrom.map((a) => a.toLowerCase()) : [])]);
    // Keep a valid explicit default; otherwise choose an enabled admin/oldest mailbox.
    await db.query(`update sending_config s set default_mailbox_id=(
      select m.id from mailbox m where m.tenant_id=s.tenant_id and m.deleting_at is null
      and (m.shared or m.owner_user_id=$2) and (s.provider='cloudflare' or s.allowed_from ? m.address::text)
      order by (m.id=s.default_mailbox_id) desc nulls last,(split_part(m.address::text,'@',1)='admin') desc,m.created_at,m.id limit 1
    ) where s.tenant_id=$1`,[tid,actorId]);
    await audit(db, { tenantId: tid, actorId, action: 'sending.configure', metadata: { provider: input.provider } });
  });
  return c.json({ ok: true });
});

type SendContext = Pick<Outbound, 'from' | 'inReplyTo' | 'references'>;
type Delivery = { id: string; request_hash: string; status: string; provider: string; message_id: string | null; thread_id: string | null; result: (DeliveryResult & { context?: SendContext }) | null; created_at: Date };

sending.post('/tenants/:tid/mailboxes/:mid/send', async (c) => {
  const tid = id(c.req.param('tid')); const mid = id(c.req.param('mid')); const actorId = c.get('session').user.id;
  await authorize(actorId, 'mail.send', await resolveResource(mailboxResource(tid, mid), tid));
  const input = await body(c, sendInput);
  const hash = createHmac('sha256', env.BETTER_AUTH_SECRET).update(JSON.stringify(input)).digest('hex');
  let log = await one<Delivery>('select * from delivery_log where mailbox_id=$1 and request_key=$2', [mid, input.requestKey]);
  if (log && log.request_hash !== hash) throw new IamError(409, 'SEND_CHANGED', 'This draft already has a sending attempt. Check its outcome before creating a new message.');
  if (log?.status === 'saved') return c.json({ ...log.result, id: log.id, threadId: log.thread_id, saved: true });
  if (log && ['sending', 'unknown'].includes(log.status)) throw new IamError(409, 'SEND_UNKNOWN', 'This message is already being sent or its outcome is uncertain. Check the provider’s Sent/activity before creating another copy.');
  const worker = await readyWorker(tid);
  const health = await workerFetch(worker, 'GET', '/v1/health').then((r) => r.json()).catch(() => null) as { capabilities?: string[] } | null;
  if (!health?.capabilities?.includes('outbound')) throw new IamError(409, 'WORKER_UPDATE_REQUIRED', 'Run Email setup again to update your mail Worker before sending.');
  await syncMailbox(tid, mid);
  const mailbox = await one<{ address: string; display_name: string }>('select address, display_name from mailbox where id=$1 and tenant_id=$2', [mid, tid]);
  const config = await one<Config>('select * from sending_config where tenant_id=$1', [tid]);
  if (!config && log?.status !== 'accepted') throw new IamError(409, 'SENDING_NOT_CONFIGURED', 'An admin needs to configure Sending in workspace Settings.');
  if (log?.status !== 'accepted' && config?.provider === 'gmail' && !config.allowed_from.includes(mailbox!.address.toLowerCase())) throw new IamError(409, 'ALIAS_REQUIRED', 'An admin must verify this mailbox as a Gmail Send mail as alias and enable it in Sending settings.');
  let inReplyTo: string | null = null; let references: string[] = [];
  if (input.threadId && log?.status !== 'accepted') {
    const response = await workerFetch(worker, 'GET', `/v1/mailboxes/${mid}/threads/${input.threadId}`);
    if (!response.ok) throw new IamError(404, 'THREAD_NOT_FOUND', 'The conversation is not in this mailbox.');
    const thread = await response.json() as { messages: { messageId: string | null; references: string[] }[] };
    const last = thread.messages.at(-1);
    const safeId = (s: string) => /^[^\s<>\x00-\x1f]{1,200}$/.test(s.replace(/^<|>$/g, ''));
    if (last?.messageId && safeId(last.messageId)) {
      inReplyTo = `<${last.messageId.replace(/^<|>$/g, '')}>`;
      references = [...(last.references ?? []).filter(safeId).slice(-8).map((r) => `<${r.replace(/^<|>$/g, '')}>`), inReplyTo];
    }
  }
  const mail: Outbound = { ...input, from: { address: mailbox!.address, name: mailbox!.display_name.replace(/[\r\n\0]/g, ' ') }, date: (log?.created_at ?? new Date()).toISOString(),
    messageId: log?.message_id ?? `<${crypto.randomUUID()}@${mailbox!.address.split('@')[1]}>`, inReplyTo, references };
  if (log?.status === 'accepted' && log.result?.context) Object.assign(mail, log.result.context);
  let raw = await rawMessage(mail);
  if (raw.length > MAX_MESSAGE_BYTES) throw new IamError(400, 'TOO_LARGE', 'The message exceeds 25 MiB after attachment encoding. Use smaller files.');
  if (!log || log.status === 'failed') {
    // Accepted retries repair storage without needing the provider's credentials again.
    const t = config!.provider === 'cloudflare' ? await one<Tenant>('select cloudflare_account_id, cloudflare_user_id from tenant where id=$1', [tid]) : null;
    const cf = config!.provider === 'cloudflare' ? await cloudflareFor(t!.cloudflare_user_id!) : null;
    const password = config!.provider === 'gmail' ? open(config!.credentials_enc!) : null;
    log = await transaction(async (db) => {
      // Serializes admission per tenant; the unique key also covers concurrent taps.
      await db.query('select id from tenant where id=$1 for update', [tid]);
      if (!await one('select 1 from mailbox where id=$1 and tenant_id=$2 and deleting_at is null',[mid,tid],db)) throw new IamError(409,'MAILBOX_DELETING','This mailbox is being deleted.');
      const count = await one<{ n: string }>("select count(*) as n from delivery_log where tenant_id=$1 and created_at > now() - interval '1 hour'", [tid], db);
      if (Number(count?.n) >= 100) throw new IamError(429, 'SEND_LIMIT', 'This workspace reached 100 sending attempts per hour. Try later.');
      const row = await one<Delivery>(`insert into delivery_log(tenant_id,mailbox_id,actor_id,request_key,request_hash,status,provider,message_id) values($1,$2,$3,$4,$5,'sending',$6,$7)
        on conflict(mailbox_id,request_key) do update set status='sending',provider=excluded.provider,created_at=now() where delivery_log.status='failed' and delivery_log.request_hash=excluded.request_hash returning *`,
      [tid,mid,actorId,input.requestKey,hash,config!.provider,mail.messageId], db);
      if (!row) throw new IamError(409, 'SEND_IN_PROGRESS', 'This message already has a sending attempt. Retry to check its status.');
      return row;
    });
    mail.date = log.created_at.toISOString(); mail.messageId = log.message_id!;
    let result: DeliveryResult;
    try {
      result = cf ? await sendCloudflare(mail, cf, t!.cloudflare_account_id!) : await sendGmail(mail, config!.gmail_user!, password!);
    } catch (err) {
      const failure = err instanceof DeliveryError ? err : new DeliveryError(true, 'SEND_UNKNOWN', 'The delivery outcome is uncertain. Check your provider before trying another copy.');
      await pool.query('update delivery_log set status=$2 where id=$1', [log.id, failure.uncertain ? 'unknown' : 'failed']);
      throw new IamError(502, failure.code, failure.message);
    }
    const storedResult = { ...result, context: { from: mail.from, inReplyTo: mail.inReplyTo, references: mail.references } };
    await pool.query("update delivery_log set status='accepted',result=$2,message_id=$3 where id=$1", [log.id, JSON.stringify(storedResult), result.messageId ?? mail.messageId]);
    log = { ...log, status: 'accepted', result: storedResult, message_id: result.messageId ?? mail.messageId };
  }
  mail.messageId = log.message_id!; mail.date = log.created_at.toISOString();
  raw = await rawMessage(mail);
  const copyPath = `/v1/mailboxes/${mid}/outbound/${log.id}`;
  const stored = await (async () => {
    await workerPutBytes(worker, `${copyPath}/raw`, raw);
    for (const [i, a] of mail.attachments.entries()) await workerPutBytes(worker, `${copyPath}/att-${i}`, Buffer.from(a.content, 'base64'));
    return workerFetch(worker, 'PUT', copyPath, { ...mail, rawSize: raw.length,
      attachments: mail.attachments.map((a) => ({ name: a.name, type: a.type, size: Buffer.from(a.content, 'base64').length })) });
  })().catch(() => null);
  if (!stored?.ok) throw new IamError(502, 'SENT_COPY_PENDING', 'The provider processed this message, but its Sent copy could not be saved. Retry this unchanged draft to save it; it will not be sent again.');
  const saved = await stored.json() as { threadId: string };
  await pool.query("update delivery_log set status='saved',thread_id=$2 where id=$1", [log.id,saved.threadId]);
  return c.json({ ...log.result, id: log.id, threadId: saved.threadId, saved: true });
});
