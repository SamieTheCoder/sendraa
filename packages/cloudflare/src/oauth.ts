import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Cloudflare OAuth 2.0 / OIDC endpoints.
 *
 * Source: https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/
 * Cloudflare supports the Authorization Code flow only — there is no client
 * credentials, implicit, password, or device authorization grant.
 */
export const CF_OAUTH = {
  authorize: 'https://dash.cloudflare.com/oauth2/auth',
  token: 'https://dash.cloudflare.com/oauth2/token',
  revoke: 'https://dash.cloudflare.com/oauth2/revoke',
  logout: 'https://dash.cloudflare.com/oauth2/logout',
  userinfo: 'https://dash.cloudflare.com/oauth2/userinfo',
  jwks: 'https://dash.cloudflare.com/.well-known/jwks.json',
  discovery: 'https://dash.cloudflare.com/.well-known/openid-configuration',
} as const;

export interface OAuthClientConfig {
  clientId: string;
  /** Omit for public clients using PKCE. Sendraa uses a confidential client. */
  clientSecret?: string;
  redirectUri: string;
}

export interface AuthorizeParams {
  state: string;
  scopes: readonly string[];
  /** PKCE challenge. Optional for confidential clients, but we always send it. */
  codeChallenge?: string;
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

const userInfoSchema = z.object({
  sub: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  // Cloudflare may return additional claims; keep them rather than stripping.
}).loose();

export type CloudflareUserInfo = z.infer<typeof userInfoSchema>;

export class CloudflareOAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'CloudflareOAuthError';
  }
}

/** Generates a PKCE verifier and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(32).toString('base64url');
}

export class CloudflareOAuth {
  constructor(private readonly config: OAuthClientConfig) {}

  /**
   * Builds the URL the user is sent to in a system browser.
   *
   * `offline_access` is required to receive a refresh token, which the platform
   * needs so provisioning, DNS checks and fleet upgrades can run while the user
   * is away. Cloudflare adds or removes protocol scopes automatically based on
   * the client's configured grant and response types.
   */
  authorizeUrl(params: AuthorizeParams): string {
    const url = new URL(CF_OAUTH.authorize);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', params.scopes.join(' '));
    url.searchParams.set('state', params.state);

    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    });
    if (codeVerifier) body.set('code_verifier', codeVerifier);
    return this.tokenRequest(body);
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    return this.tokenRequest(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    );
  }

  async userInfo(accessToken: string): Promise<CloudflareUserInfo> {
    const res = await fetch(CF_OAUTH.userinfo, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new CloudflareOAuthError('userinfo request failed', res.status, text);
    }
    return userInfoSchema.parse(JSON.parse(text));
  }

  /**
   * Revokes a token. Called when a tenant disconnects so we do not retain
   * usable credentials after consent is withdrawn.
   */
  async revoke(token: string): Promise<void> {
    const res = await fetch(CF_OAUTH.revoke, {
      method: 'POST',
      headers: this.tokenHeaders(),
      body: new URLSearchParams({ token }),
    });
    if (!res.ok && res.status !== 404) {
      throw new CloudflareOAuthError('revoke failed', res.status, await res.text());
    }
  }

  private async tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    // Public (PKCE) clients have no secret, so the client_id travels in the body.
    if (!this.config.clientSecret) body.set('client_id', this.config.clientId);

    const res = await fetch(CF_OAUTH.token, {
      method: 'POST',
      headers: this.tokenHeaders(),
      body,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new CloudflareOAuthError('token request failed', res.status, text);
    }
    return tokenResponseSchema.parse(JSON.parse(text));
  }

  private tokenHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (this.config.clientSecret) {
      // client_secret_basic
      const basic = Buffer.from(
        `${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`,
      ).toString('base64');
      headers.authorization = `Basic ${basic}`;
    }
    return headers;
  }
}
