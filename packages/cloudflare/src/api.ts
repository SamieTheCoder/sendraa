import { z } from 'zod';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: { code: number; message: string }[],
  ) {
    super(message);
    this.name = 'CloudflareApiError';
  }

  has(code: number): boolean {
    return this.errors.some((e) => e.code === code);
  }

  /** True when the account lacks the entitlement, e.g. Email Sending on Workers Free. */
  get notEntitled(): boolean {
    return this.has(10105);
  }

  /** True when the token is expired or revoked and the tenant must re-authorise. */
  get needsReauth(): boolean {
    return this.status === 401 || this.has(10101);
  }

  /** R2 has not been turned on for the account (it must be enabled once in the dashboard). */
  get r2NotEnabled(): boolean {
    return this.has(10042) || this.errors.some((e) => /enable R2/i.test(e.message));
  }
}

const envelope = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).default([]),
  result: z.unknown(),
  result_info: z
    .object({ page: z.number(), per_page: z.number(), total_count: z.number() })
    .partial()
    .optional(),
});

const accountSchema = z.object({ id: z.string(), name: z.string() });
const zoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  account: accountSchema.partial().optional(),
});
const d1Schema = z.object({ uuid: z.string(), name: z.string() });
const dnsRecordSchema = z.object({ id: z.string(), type: z.string(), name: z.string(), content: z.string() });
const routingSchema = z.object({ enabled: z.boolean(), status: z.string().optional() }).loose();

export type CloudflareAccount = z.infer<typeof accountSchema>;
export type CloudflareZone = z.infer<typeof zoneSchema>;
export type D1Database = z.infer<typeof d1Schema>;
export type DnsRecord = z.infer<typeof dnsRecordSchema>;

export type WorkerBinding =
  | { type: 'd1'; name: string; database_id: string }
  | { type: 'r2_bucket'; name: string; bucket_name: string }
  | { type: 'secret_text'; name: string; text: string }
  | { type: 'plain_text'; name: string; text: string };

const enc = encodeURIComponent;

/**
 * Thin authenticated client for the Cloudflare REST API.
 *
 * Takes a bearer token that may be either an OAuth access token obtained from a
 * tenant's consent or a classic API token — the API treats them identically.
 * Every endpoint used here was checked against Cloudflare's OpenAPI spec.
 */
export class CloudflareApi {
  constructor(private readonly accessToken: string) {}

  async listAccounts(): Promise<CloudflareAccount[]> {
    return z.array(accountSchema).parse(await this.get('/accounts'));
  }

  /** The signed-in Cloudflare user. Needs `user-details.read`. */
  async getUser(): Promise<{ id: string; email: string; first_name?: string | null; last_name?: string | null }> {
    return z
      .object({ id: z.string(), email: z.string(), first_name: z.string().nullish(), last_name: z.string().nullish() })
      .loose()
      .parse(await this.get('/user'));
  }

  /** Zones the token can see. Optionally narrowed to one account. */
  async listZones(accountId?: string): Promise<CloudflareZone[]> {
    const path = accountId ? `/zones?account.id=${enc(accountId)}&per_page=50` : '/zones?per_page=50';
    return z.array(zoneSchema).parse(await this.get(path));
  }

  // --- D1 -------------------------------------------------------------------

  async findD1(accountId: string, name: string): Promise<D1Database | null> {
    const list = z.array(d1Schema).parse(await this.get(`/accounts/${accountId}/d1/database?name=${enc(name)}`));
    return list.find((d) => d.name === name) ?? null;
  }

  async createD1(accountId: string, name: string): Promise<D1Database> {
    return d1Schema.parse(await this.post(`/accounts/${accountId}/d1/database`, { name }));
  }

  /** Runs SQL. Several statements separated by semicolons run as one batch. */
  async queryD1(accountId: string, databaseId: string, sql: string, params: string[] = []): Promise<unknown> {
    return this.post(`/accounts/${accountId}/d1/database/${databaseId}/query`, { sql, params });
  }

  // --- R2 -------------------------------------------------------------------

  async hasBucket(accountId: string, name: string): Promise<boolean> {
    try {
      await this.get(`/accounts/${accountId}/r2/buckets/${enc(name)}`);
      return true;
    } catch (err) {
      if (err instanceof CloudflareApiError && err.status === 404) return false;
      throw err;
    }
  }

  async createBucket(accountId: string, name: string): Promise<void> {
    await this.post(`/accounts/${accountId}/r2/buckets`, { name });
  }

  // --- Workers --------------------------------------------------------------

  /** Uploads (or replaces) an ES-module Worker with its bindings. */
  async uploadWorker(
    accountId: string,
    name: string,
    script: string,
    opts: { compatibilityDate: string; bindings: WorkerBinding[] },
  ): Promise<void> {
    const metadata = {
      main_module: 'worker.js',
      compatibility_date: opts.compatibilityDate,
      bindings: opts.bindings,
      observability: { enabled: true, head_sampling_rate: 1 },
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('worker.js', new Blob([script], { type: 'application/javascript+module' }), 'worker.js');
    await this.request('PUT', `/accounts/${accountId}/workers/scripts/${enc(name)}`, form);
  }

  /** The account's workers.dev subdomain, or null if it has never been set up. */
  async getWorkersSubdomain(accountId: string): Promise<string | null> {
    try {
      const r = z.object({ subdomain: z.string().nullable().optional() }).parse(await this.get(`/accounts/${accountId}/workers/subdomain`));
      return r.subdomain || null;
    } catch (err) {
      if (err instanceof CloudflareApiError && err.status === 404) return null;
      throw err;
    }
  }

  async createWorkersSubdomain(accountId: string, subdomain: string): Promise<void> {
    await this.put(`/accounts/${accountId}/workers/subdomain`, { subdomain });
  }

  /** Serves the Worker on <name>.<subdomain>.workers.dev. */
  async enableWorkersDev(accountId: string, name: string): Promise<void> {
    await this.post(`/accounts/${accountId}/workers/scripts/${enc(name)}/subdomain`, { enabled: true, previews_enabled: false });
  }

  // --- Email Routing and DNS ------------------------------------------------

  async getEmailRouting(zoneId: string): Promise<z.infer<typeof routingSchema>> {
    return routingSchema.parse(await this.get(`/zones/${zoneId}/email/routing`));
  }

  /** Turns on Email Routing: Cloudflare adds and locks the MX and SPF records. */
  async enableEmailRouting(zoneId: string, zoneName: string): Promise<void> {
    await this.post(`/zones/${zoneId}/email/routing/dns`, { name: zoneName });
  }

  /** Points every address without its own rule at a Worker. */
  async setCatchAllToWorker(zoneId: string, workerName: string): Promise<void> {
    await this.put(`/zones/${zoneId}/email/routing/rules/catch_all`, {
      name: 'Sendraa',
      enabled: true,
      matchers: [{ type: 'all' }],
      actions: [{ type: 'worker', value: [workerName] }],
    });
  }

  async listDnsRecords(zoneId: string, filter: { type: string; name: string }): Promise<DnsRecord[]> {
    return z.array(dnsRecordSchema).parse(await this.get(`/zones/${zoneId}/dns_records?type=${enc(filter.type)}&name.exact=${enc(filter.name)}`));
  }

  async createDnsRecord(zoneId: string, record: { type: string; name: string; content: string; comment?: string }): Promise<void> {
    await this.post(`/zones/${zoneId}/dns_records`, { ttl: 1, ...record });
  }

  // --- Transport ------------------------------------------------------------

  async get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  async put(path: string, body: unknown): Promise<unknown> {
    return this.request('PUT', path, body);
  }

  async delete(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const isForm = body instanceof FormData;
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      signal: AbortSignal.timeout(45_000),
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        // FormData sets its own multipart boundary.
        ...(body === undefined || isForm ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
    });

    const text = await res.text();

    let parsed: z.infer<typeof envelope>;
    try {
      parsed = envelope.parse(JSON.parse(text));
    } catch {
      throw new CloudflareApiError(`unparseable response from ${method} ${path} (${res.status})`, res.status, []);
    }

    if (!res.ok || !parsed.success) {
      const detail = parsed.errors.map((e) => `${e.code} ${e.message}`).join('; ');
      throw new CloudflareApiError(`${method} ${path.split('?')[0]} failed: ${detail || res.status}`, res.status, parsed.errors);
    }

    return parsed.result;
  }
}
