import { CloudflareApi, CloudflareApiError } from '@sendraa/cloudflare';

import { auth } from './auth.js';
import { one } from './db.js';
import { IamError } from './iam/policy.js';

const REAUTH = 'Sendraa no longer has access to your Cloudflare account. Sign in with Cloudflare again.';

/**
 * A Cloudflare API client acting as `userId`, using the OAuth tokens Better
 * Auth stored at sign-in. Better Auth refreshes the access token when it has
 * expired. Works without a request, so background setup can use it too.
 * The tokens never leave the server.
 */
export async function cloudflareFor(userId: string): Promise<CloudflareApi> {
  const account = await one<{ id: string }>('select id from account where "userId" = $1 and "providerId" = $2', [userId, 'cloudflare']);
  if (!account) {
    throw new IamError(403, 'CLOUDFLARE_REQUIRED', 'Sign in with Cloudflare to use your Cloudflare account. Team members cannot.');
  }
  try {
    const { accessToken } = await auth.api.getAccessToken({ body: { accountId: account.id, userId } });
    if (!accessToken) throw new Error('no access token');
    return new CloudflareApi(accessToken);
  } catch {
    // Refresh failed: the admin revoked Sendraa in Cloudflare, or the grant expired.
    throw new IamError(401, 'CLOUDFLARE_REAUTH', REAUTH);
  }
}

/** Maps Cloudflare API failures to responses the app can explain. */
export function cloudflareError(err: unknown): never {
  if (err instanceof IamError) throw err;
  if (err instanceof CloudflareApiError) {
    if (err.needsReauth) throw new IamError(401, 'CLOUDFLARE_REAUTH', REAUTH);
    if (err.status === 403) {
      throw new IamError(403, 'CLOUDFLARE_FORBIDDEN', 'Cloudflare refused the request. The permission may have been declined at sign-in. Sign in with Cloudflare again and allow it.');
    }
    throw new IamError(502, 'CLOUDFLARE_ERROR', `Cloudflare returned an error: ${err.message}`);
  }
  throw err;
}
