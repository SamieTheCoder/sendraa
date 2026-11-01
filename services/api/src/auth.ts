import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { genericOAuth } from 'better-auth/plugins';

import { CF_OAUTH, CloudflareApi, onboardingScopes } from '@sendraa/cloudflare';

import { pool } from './db.js';
import { cloudflareConfigured, devAdminSignup, env, isDev } from './env.js';
import { findOpenInvite } from './invites.js';

export const INVITE_HEADER = 'x-sendraa-invite';

/**
 * Two ways in, matching the product:
 *
 * - Admins sign in with Cloudflare (OIDC). That account is also how Sendraa
 *   provisions mail into their Cloudflare account later.
 * - Members sign in with email and password. They cannot sign up on their
 *   own; an account is created only by accepting an invite.
 */
export const auth = betterAuth({
  appName: 'Sendraa',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: pool,
  // An OAuth failure (consent declined, Cloudflare error) returns to the app's
  // sign-in screen instead of stranding the user on an API error page. The
  // deep link closes the in-app browser.
  onAPIError: { errorURL: `${env.APP_SCHEME}://sign-in` },
  trustedOrigins: [
    `${env.APP_SCHEME}://`,
    `${env.APP_SCHEME}://*`,
    // Local tools (smoke test, curl) reach the API directly, not through the tunnel.
    ...(isDev ? ['exp://', 'exp://**', `http://localhost:${env.PORT}`] : []),
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  account: {
    // Cloudflare refresh tokens can change DNS and deploy Workers in the
    // customer's account, so they are encrypted at rest.
    encryptOAuthTokens: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return;
      // Password sign-up is only for accepting an invite, and only for the invited address.
      const token = ctx.headers?.get(INVITE_HEADER) ?? '';
      if (!token && devAdminSignup) return;
      const invite = token ? await findOpenInvite(token) : null;
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase();
      if (!invite || invite.email.toLowerCase() !== email) {
        throw new APIError('FORBIDDEN', { message: 'Accounts are created from an invite. Ask your workspace admin for one.' });
      }
    }),
  },
  plugins: [
    expo(),
    ...(cloudflareConfigured
      ? [
          genericOAuth({
            config: [
              {
                providerId: 'cloudflare',
                clientId: env.CLOUDFLARE_CLIENT_ID!,
                clientSecret: env.CLOUDFLARE_CLIENT_SECRET!,
                discoveryUrl: CF_OAUTH.discovery,
                // Set explicitly so a failed discovery fetch at startup cannot
                // silently drop the provider. Discovery still supplies the JWKS.
                authorizationUrl: CF_OAUTH.authorize,
                tokenUrl: CF_OAUTH.token,
                userInfoUrl: CF_OAUTH.userinfo,
                scopes: [...onboardingScopes()],
                // Matches token_endpoint_auth_method on the client (scripts/create-oauth-client.ts).
                tokenEndpointAuth: { method: 'client_secret_basic' },
                pkce: true,
                // Cloudflare's userinfo only has `sub`. Identity comes from the
                // Cloudflare API instead, with the access token just issued.
                getUserInfo: async (tokens) => {
                  if (!tokens.accessToken) return null;
                  const cf = await new CloudflareApi(tokens.accessToken).getUser();
                  const name = [cf.first_name, cf.last_name].filter(Boolean).join(' ').trim();
                  return { id: cf.id, sub: cf.id, email: cf.email.toLowerCase(), name: name || cf.email.split('@')[0]!, emailVerified: true };
                },
                accountSubject: ({ profile }) => String(profile.id ?? profile.sub ?? ''),
                mapProfileToUser: (profile) => ({ emailVerified: true, name: String(profile.name ?? '') }),
              },
            ],
          }),
        ]
      : []),
  ],
});

export type Session = typeof auth.$Infer.Session;
