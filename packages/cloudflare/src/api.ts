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

  /** True when the account lacks the entitlement, e.g. Email Sending on Workers Free. */
  get notEntitled(): boolean {
    return this.errors.some((e) => e.code === 10105);
  }

  /** True when the token is expired or revoked and the tenant must re-authorise. */
  get needsReauth(): boolean {
    return this.status === 401 || this.errors.some((e) => e.code === 10101);
  }
}

const envelope = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).default([]),
  result: z.unknown(),
  result_info: z
    .object({ page: z.number(), per_page: z.number(), total_count: z.number() })
    .optional(),
});

const accountSchema = z.object({ id: z.string(), name: z.string() });
const zoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  account: accountSchema.partial().optional(),
});

export type CloudflareAccount = z.infer<typeof accountSchema>;
export type CloudflareZone = z.infer<typeof zoneSchema>;

/**
 * Thin authenticated client for the Cloudflare REST API.
 *
 * Takes a bearer token that may be either an OAuth access token obtained from a
 * tenant's consent or a classic API token — the API treats them identically.
 */
export class CloudflareApi {
  constructor(private readonly accessToken: string) {}

  async listAccounts(): Promise<CloudflareAccount[]> {
    return z.array(accountSchema).parse(await this.get('/accounts'));
  }

  /** Zones the token can see. Optionally narrowed to one account. */
  async listZones(accountId?: string): Promise<CloudflareZone[]> {
    const path = accountId
      ? `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50`
      : '/zones?per_page=50';
    return z.array(zoneSchema).parse(await this.get(path));
  }

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
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await res.text();

    let parsed: z.infer<typeof envelope>;
    try {
      parsed = envelope.parse(JSON.parse(text));
    } catch {
      throw new CloudflareApiError(
        `unparseable response from ${method} ${path}`,
        res.status,
        [],
      );
    }

    if (!res.ok || !parsed.success) {
      const detail = parsed.errors.map((e) => `${e.code} ${e.message}`).join('; ');
      throw new CloudflareApiError(
        `${method} ${path} failed: ${detail || res.status}`,
        res.status,
        parsed.errors,
      );
    }

    return parsed.result;
  }
}
