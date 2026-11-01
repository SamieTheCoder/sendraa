import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { genericOAuth } from 'better-auth/plugins';

import { onboardingScopes } from '@sendraa/cloudflare';

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
  trustedOrigins: [`${env.APP_SCHEME}://`, `${env.APP_SCHEME}://*`, ...(isDev ? ['exp://', 'exp://**'] : [])],
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
                discoveryUrl: 'https://dash.cloudflare.com/.well-known/openid-configuration',
                scopes: [...onboardingScopes(), 'email', 'profile'],
                pkce: true,
              },
            ],
          }),
        ]
      : []),
  ],
});

export type Session = typeof auth.$Infer.Session;
