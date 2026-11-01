import { Hono } from 'hono';

import { cloudflareError, cloudflareFor } from '../cloudflare.js';
import { requireSession, type AppEnv } from '../http.js';
import { IamError } from '../iam/policy.js';

/**
 * What the signed-in admin's Cloudflare consent exposes. These read the
 * admin's own Cloudflare account, so they need no workspace role.
 */
export const cloudflare = new Hono<AppEnv>();
cloudflare.use('*', requireSession);

cloudflare.get('/cloudflare/accounts', async (c) => {
  const cf = await cloudflareFor(c.get('session').user.id, c.req.raw.headers);
  const accounts = await cf.listAccounts().catch(cloudflareError);
  if (accounts.length === 0) {
    // Consent succeeded but no account was shared. Either the person picked
    // none, or a Super Administrator has turned off third-party OAuth apps.
    throw new IamError(
      409,
      'NO_CLOUDFLARE_ACCOUNT',
      'Cloudflare did not share any account with Sendraa. Sign in again and select an account. If none can be selected, a Super Administrator of that account has turned off access for third-party apps.',
    );
  }
  return c.json({ accounts: accounts.map((a) => ({ id: a.id, name: a.name })) });
});

cloudflare.get('/cloudflare/zones', async (c) => {
  const accountId = c.req.query('accountId');
  if (accountId !== undefined && !/^[0-9a-f]{32}$/.test(accountId)) throw new IamError(400, 'INVALID_ARGUMENT', 'accountId is not a Cloudflare account id.');
  const cf = await cloudflareFor(c.get('session').user.id, c.req.raw.headers);
  const zones = await cf.listZones(accountId).catch(cloudflareError);
  return c.json({
    zones: zones.map((z) => ({ id: z.id, name: z.name, status: z.status, accountId: z.account?.id ?? null })),
  });
});
