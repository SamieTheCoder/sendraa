import { CloudflareApiError, type CloudflareApi } from '@sendraa/cloudflare';
import { loadArtifact, WORKER_NAME, type WorkerArtifact } from '@sendraa/mail-worker/artifact';

import { cloudflareFor } from './cloudflare.js';
import { newSecret, open, seal } from './crypto.js';
import { audit, one, pool, query } from './db.js';
import { env } from './env.js';
import { grant } from './iam/policy.js';
import { mailboxResource } from './iam/roles.js';

/**
 * F2 + F3: connect a domain and create the mail system inside the tenant's own
 * Cloudflare account.
 *
 * Every step checks what already exists before creating anything, and records
 * its result in provision_step, so running setup again resumes where it
 * stopped. Nothing here deletes or overwrites a record the tenant made: if a
 * conflicting MX or DMARC record exists, setup stops and says so.
 */

export const STEPS = [
  { id: 'database', title: 'Create the mail database (D1)' },
  { id: 'schema', title: 'Create mail tables' },
  { id: 'storage', title: 'Create attachment storage (R2)' },
  { id: 'worker', title: 'Deploy the Sendraa mail Worker' },
  { id: 'worker_url', title: 'Give the Worker its address' },
  { id: 'routing', title: 'Turn on Email Routing' },
  { id: 'dmarc', title: 'Add a DMARC record' },
  { id: 'catch_all', title: 'Send all mail for the domain to the Worker' },
  { id: 'mailbox', title: 'Create admin@ mailbox' },
  { id: 'check', title: 'Check the Worker answers' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

/** A failure the admin can act on, shown in the app as is. */
export class SetupError extends Error {}

type Tenant = {
  id: string;
  cloudflare_account_id: string;
  cloudflare_user_id: string;
  d1_database_id: string | null;
  worker_secret_enc: string | null;
  worker_url: string | null;
};

type Domain = { id: string; name: string; zone_id: string };

type Ctx = { tenant: Tenant; domain: Domain; cf: CloudflareApi; artifact: WorkerArtifact; accountId: string };

const RESOURCE_NAME = WORKER_NAME; // D1 database and R2 bucket share the Worker's name.

async function setStep(tenantId: string, step: StepId, status: 'running' | 'done' | 'failed', detail: Record<string, unknown> = {}, error: string | null = null) {
  await pool.query(
    `insert into provision_step (tenant_id, step, status, detail, error, updated_at) values ($1, $2, $3, $4, $5, now())
     on conflict (tenant_id, step) do update set status = excluded.status, detail = provision_step.detail || excluded.detail, error = excluded.error, updated_at = now()`,
    [tenantId, step, status, JSON.stringify(detail), error],
  );
}

const run: Record<StepId, (ctx: Ctx) => Promise<Record<string, unknown>>> = {
  async database({ cf, accountId, tenant }) {
    const db = (await cf.findD1(accountId, RESOURCE_NAME)) ?? (await cf.createD1(accountId, RESOURCE_NAME));
    await pool.query('update tenant set d1_database_id = $2 where id = $1', [tenant.id, db.uuid]);
    tenant.d1_database_id = db.uuid;
    return { databaseId: db.uuid };
  },

  async schema({ cf, accountId, tenant, artifact }) {
    // Migrations use IF NOT EXISTS, so re-running them is harmless.
    for (const m of artifact.migrations) await cf.queryD1(accountId, tenant.d1_database_id!, m.sql);
    return { applied: artifact.migrations.map((m) => m.name) };
  },

  async storage({ cf, accountId, tenant }) {
    try {
      if (!(await cf.hasBucket(accountId, RESOURCE_NAME))) await cf.createBucket(accountId, RESOURCE_NAME);
    } catch (err) {
      if (err instanceof CloudflareApiError && err.r2NotEnabled) {
        throw new SetupError(
          'R2 storage is not turned on for this Cloudflare account. Open Cloudflare, go to R2 Object Storage, and select "Purchase R2" (the free plan costs nothing but Cloudflare may ask for a payment method). Then run setup again.',
        );
      }
      throw err;
    }
    await pool.query('update tenant set r2_bucket = $2 where id = $1', [tenant.id, RESOURCE_NAME]);
    return { bucket: RESOURCE_NAME };
  },

  async worker({ cf, accountId, tenant, artifact }) {
    let secret: string;
    if (tenant.worker_secret_enc) {
      secret = open(tenant.worker_secret_enc);
    } else {
      secret = newSecret();
      tenant.worker_secret_enc = seal(secret);
      await pool.query('update tenant set worker_secret_enc = $2 where id = $1', [tenant.id, tenant.worker_secret_enc]);
    }
    await cf.uploadWorker(accountId, artifact.name, artifact.script, {
      compatibilityDate: artifact.compatibilityDate,
      bindings: [
        { type: 'd1', name: 'DB', database_id: tenant.d1_database_id! },
        { type: 'r2_bucket', name: 'BLOB', bucket_name: RESOURCE_NAME },
        { type: 'secret_text', name: 'TENANT_SECRET', text: secret },
        { type: 'plain_text', name: 'TENANT_ID', text: tenant.id },
        { type: 'plain_text', name: 'PLATFORM_WEBHOOK', text: `${env.BETTER_AUTH_URL}/v1/hooks/mail` },
      ],
    });
    await pool.query('update tenant set worker_name = $2, worker_version = $3 where id = $1', [tenant.id, artifact.name, artifact.version]);
    return { version: artifact.version };
  },

  async worker_url({ cf, accountId, tenant, artifact }) {
    let sub = await cf.getWorkersSubdomain(accountId);
    if (!sub) {
      // A new account has no workers.dev subdomain yet. Pick one Cloudflare is unlikely to have taken.
      sub = `sendraa-${accountId.slice(0, 10)}`;
      await cf.createWorkersSubdomain(accountId, sub);
    }
    await cf.enableWorkersDev(accountId, artifact.name);
    const url = `https://${artifact.name}.${sub}.workers.dev`;
    await pool.query('update tenant set worker_url = $2 where id = $1', [tenant.id, url]);
    tenant.worker_url = url;
    return { url };
  },

  async routing({ cf, domain }) {
    const state = await cf.getEmailRouting(domain.zone_id).catch(() => null);
    if (!state?.enabled) {
      try {
        await cf.enableEmailRouting(domain.zone_id, domain.name);
      } catch (err) {
        if (err instanceof CloudflareApiError && err.status < 500) {
          const mx = await cf.listDnsRecords(domain.zone_id, { type: 'MX', name: domain.name }).catch(() => []);
          const foreign = mx.filter((r) => !r.content.endsWith('.mx.cloudflare.net'));
          if (foreign.length) {
            throw new SetupError(
              `${domain.name} already receives mail somewhere else (MX ${foreign.map((r) => r.content).join(', ')}). Sendraa will not remove those records. Delete them in Cloudflare DNS if you want Sendraa to receive this domain's mail, then run setup again.`,
            );
          }
        }
        throw err;
      }
    }
    await pool.query('update domain set routing_enabled_at = coalesce(routing_enabled_at, now()) where id = $1', [domain.id]);
    return { wasEnabled: Boolean(state?.enabled) };
  },

  async dmarc({ cf, domain }) {
    const name = `_dmarc.${domain.name}`;
    const existing = await cf.listDnsRecords(domain.zone_id, { type: 'TXT', name });
    if (existing.some((r) => r.content.replace(/^"|"$/g, '').startsWith('v=DMARC1'))) return { created: false };
    // p=none: Gmail-path sending is not DKIM-aligned, so a stricter policy would bounce it (ARCHITECTURE.md §2).
    await cf.createDnsRecord(domain.zone_id, { type: 'TXT', name, content: '"v=DMARC1; p=none"', comment: 'Added by Sendraa' });
    return { created: true };
  },

  async catch_all({ cf, domain, artifact }) {
    // Rules the tenant already has keep working; only unmatched addresses reach the Worker.
    await cf.setCatchAllToWorker(domain.zone_id, artifact.name);
    return { worker: artifact.name };
  },

  async mailbox({ tenant, domain }) {
    const address = `admin@${domain.name}`;
    let mailbox = await one<{ id: string }>('select id from mailbox where address = $1', [address]);
    if (!mailbox) {
      mailbox = await one<{ id: string }>(
        `insert into mailbox (tenant_id, domain_id, address, display_name) values ($1, $2, $3, 'Admin') returning id`,
        [tenant.id, domain.id, address],
      );
    }
    await workerCall(tenant, 'PUT', `/v1/mailboxes/${mailbox!.id}`, { address, displayName: 'Admin' });
    // The owner already reaches every mailbox through the tenant binding; this makes admin@ theirs explicitly.
    await grant(pool, tenant.id, mailboxResource(tenant.id, mailbox!.id), 'roles/mailUser', tenant.cloudflare_user_id, tenant.cloudflare_user_id);
    return { mailboxId: mailbox!.id, address };
  },

  async check({ tenant }) {
    const health = (await workerCall(tenant, 'GET', '/v1/health')) as { ok?: boolean; version?: string };
    if (!health.ok) throw new SetupError('The mail Worker did not answer its health check.');
    return { version: health.version };
  },
};

/** Calls the tenant's Worker with its secret. workers.dev can take a few seconds to start serving. */
export async function workerCall(tenant: Pick<Tenant, 'worker_url' | 'worker_secret_enc'>, method: string, path: string, body?: unknown): Promise<unknown> {
  if (!tenant.worker_url || !tenant.worker_secret_enc) throw new SetupError('The mail Worker is not set up yet.');
  const secret = open(tenant.worker_secret_enc);
  let last = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt));
    const res = await fetch(`${tenant.worker_url}${path}`, {
      method,
      headers: { authorization: `Bearer ${secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch((err: unknown) => {
      last = err instanceof Error ? err.message : String(err);
      return null;
    });
    if (res?.ok) return res.json();
    if (res) last = `${res.status} ${(await res.text()).slice(0, 200)}`;
    // A just-deployed workers.dev route answers 404 or "error code: 1042" until it propagates.
    // Only a rejected secret is final.
    if (res?.status === 401) break;
  }
  throw new SetupError(`The mail Worker did not respond (${last}).`);
}

/**
 * Claims the tenant for setup. Returns false if a setup is already running,
 * so two taps cannot run it twice.
 */
export async function claimSetup(tenantId: string): Promise<boolean> {
  const r = await pool.query(
    `update tenant set setup_status = 'running', setup_error = null where id = $1 and setup_status <> 'running'`,
    [tenantId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Runs every unfinished step in order. Never throws; the outcome is stored on the tenant. */
export async function provision(tenantId: string, domainId: string, actorId: string): Promise<void> {
  let current: StepId | null = null;
  try {
    const tenant = await one<Tenant>('select * from tenant where id = $1', [tenantId]);
    const domain = await one<Domain>('select id, name::text as name, zone_id from domain where id = $1 and tenant_id = $2', [domainId, tenantId]);
    if (!tenant?.cloudflare_account_id || !tenant.cloudflare_user_id) throw new SetupError('This workspace is not linked to a Cloudflare account.');
    if (!domain?.zone_id) throw new SetupError('This domain is not a Cloudflare zone.');

    const ctx: Ctx = {
      tenant,
      domain,
      accountId: tenant.cloudflare_account_id,
      cf: await cloudflareFor(tenant.cloudflare_user_id),
      artifact: await loadArtifact(),
    };

    const done = new Set(
      (await query<{ step: string; detail: { version?: string } }>(`select step, detail from provision_step where tenant_id = $1 and status = 'done'`, [tenantId]))
        // A newer Worker build means the Worker step must run again.
        .filter((s) => s.step !== 'worker' || s.detail.version === ctx.artifact.version)
        .map((s) => s.step),
    );

    for (const step of STEPS) {
      // Domain steps must run for each domain; the account steps only once.
      const perDomain = step.id === 'routing' || step.id === 'dmarc' || step.id === 'catch_all' || step.id === 'mailbox';
      if (done.has(step.id) && !perDomain) continue;
      current = step.id;
      await setStep(tenantId, step.id, 'running');
      const detail = await run[step.id](ctx);
      await setStep(tenantId, step.id, 'done', detail);
    }

    await pool.query(`update tenant set setup_status = 'ready', provisioned_at = now() where id = $1`, [tenantId]);
    await pool.query('update domain set verified_at = coalesce(verified_at, now()) where id = $1', [domainId]);
    await audit(pool, { tenantId, actorId, action: 'setup.complete', metadata: { domain: domain.name, version: ctx.artifact.version } });
  } catch (err) {
    const message = describe(err);
    console.error(JSON.stringify({ message: 'setup failed', tenantId, step: current, error: err instanceof Error ? err.message : String(err) }));
    if (current) await setStep(tenantId, current, 'failed', {}, message).catch(() => undefined);
    await pool.query(`update tenant set setup_status = 'failed', setup_error = $2 where id = $1`, [tenantId, message]).catch(() => undefined);
    await audit(pool, { tenantId, actorId, action: 'setup.fail', metadata: { step: current, error: message } }).catch(() => undefined);
  }
}

function describe(err: unknown): string {
  if (err instanceof SetupError) return err.message;
  if (err instanceof CloudflareApiError) {
    if (err.needsReauth) return 'Sendraa no longer has access to your Cloudflare account. Sign in with Cloudflare again, then retry.';
    if (err.status === 403) return `Cloudflare refused a step (${err.message}). A permission may have been declined at sign-in; sign in with Cloudflare again and allow all required permissions.`;
    return `Cloudflare returned an error: ${err.message}`;
  }
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'CLOUDFLARE_REAUTH') {
    return 'Sendraa no longer has access to your Cloudflare account. Sign in with Cloudflare again, then retry.';
  }
  return 'Setup stopped because of an unexpected error. Try again.';
}
