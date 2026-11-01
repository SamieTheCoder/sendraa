/**
 * Registers Sendraa's Cloudflare OAuth client and writes its credentials into .env.
 *
 *   CF_API_TOKEN=<token with "OAuth Client Write"> CF_ACCOUNT_ID=<id> pnpm oauth:create
 *
 * The client is private: only members of CF_ACCOUNT_ID can sign in with it.
 * That is right for development. Making it public is permanent and needs the
 * client URL's domain verified, so leave that until the platform domain is final.
 *
 * Running it again updates the existing client (matched by name) instead of
 * creating a second one, and keeps the secret already in .env.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { clientRegistrationScopes } from '@sendraa/cloudflare';

const token = process.env.CF_API_TOKEN;
const accountId = process.env.CF_ACCOUNT_ID;
const baseUrl = process.env.BETTER_AUTH_URL;
const clientName = process.env.CF_OAUTH_CLIENT_NAME ?? 'Sendraa (development)';

if (!token || !accountId || !baseUrl) {
  console.error('Set CF_API_TOKEN, CF_ACCOUNT_ID and BETTER_AUTH_URL (from .env).');
  console.error('The token needs the account permission "OAuth Client Write".');
  process.exit(1);
}
if (!baseUrl.startsWith('https://')) {
  console.error(`BETTER_AUTH_URL must be HTTPS so Cloudflare can redirect to it. Got ${baseUrl}.`);
  process.exit(1);
}

const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { success: boolean; errors: { code: number; message: string }[]; result: T };
  if (!json.success) {
    throw new Error(`${method} ${path}: ${json.errors.map((e) => `${e.code} ${e.message}`).join('; ') || res.status}`);
  }
  return json.result;
};

const { scopes, optional_scopes } = clientRegistrationScopes();
const site = new URL(baseUrl);
const config = {
  client_name: clientName,
  client_uri: `https://${site.hostname.split('.').slice(-2).join('.')}`,
  redirect_uris: [`${baseUrl.replace(/\/$/, '')}/api/auth/callback/cloudflare`],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'client_secret_basic',
  scopes,
  optional_scopes,
};

type Client = { client_id: string; client_name: string; client_secret?: string };

const existing = (await api<Client[]>('GET', '/oauth_clients')).find((c) => c.client_name === clientName);
let clientId: string;
let clientSecret: string | undefined;
if (existing) {
  await api('PATCH', `/oauth_clients/${existing.client_id}`, config);
  clientId = existing.client_id;
  console.log(`Updated OAuth client ${clientId}.`);
} else {
  const created = await api<Client>('POST', '/oauth_clients', config);
  clientId = created.client_id;
  clientSecret = created.client_secret;
  console.log(`Created OAuth client ${clientId}.`);
}

const envPath = new URL('../.env', import.meta.url);
let envText = await readFile(envPath, 'utf8');
const setVar = (name: string, value: string) => {
  const line = `${name}=${value}`;
  envText = new RegExp(`^${name}=.*$`, 'm').test(envText) ? envText.replace(new RegExp(`^${name}=.*$`, 'm'), line) : `${envText.trimEnd()}\n${line}\n`;
};
setVar('CLOUDFLARE_CLIENT_ID', clientId);
if (clientSecret) setVar('CLOUDFLARE_CLIENT_SECRET', clientSecret);
await writeFile(envPath, envText);

console.log(`Redirect URL: ${config.redirect_uris[0]}`);
console.log(clientSecret ? 'Wrote the client ID and secret to .env.' : 'Kept the existing secret in .env. Rotate it in the dashboard if it was lost.');
console.log('Restart the API so it picks up the new values.');
