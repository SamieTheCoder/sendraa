import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { genericOAuth, multiSession } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { androidPasskeyOrigins } from './android-association.js';

import { CF_OAUTH, CloudflareApi, onboardingScopes } from '@sendraa/cloudflare';

import { rememberDeviceSession } from './device-sessions.js';
import { one, pool } from './db.js';
import { androidSigningFingerprints, cloudflareConfigured, devAdminSignup, env, isDev, recoveryConfigured } from './env.js';
import { findOpenInvite } from './invites.js';
import { sendPasswordReset } from './security-mail.js';
import { crossSiteCookies, trustedWebOrigins } from './web-origins.js';

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
  advanced: {
    ipAddress: { ipAddressHeaders: env.TRUST_CLOUDFLARE_PROXY === 'true' ? ['cf-connecting-ip'] : [] },
    // Only the development API (localhost web app -> api-dev) needs cross-site cookies.
    ...(crossSiteCookies ? { defaultCookieAttributes: { sameSite: 'none' as const, secure: true } } : {}),
  },
  database: pool,
  // An OAuth failure (consent declined, Cloudflare error) returns to the app's
  // sign-in screen instead of stranding the user on an API error page. The
  // deep link closes the in-app browser.
  onAPIError: { errorURL: `${env.APP_SCHEME}://sign-in` },
  trustedOrigins: (request) => [
    `${env.APP_SCHEME}://`,
    `${env.APP_SCHEME}://*`,
    // Local tools (smoke test, curl) reach the API directly, not through the tunnel.
    ...(isDev ? ['exp://', 'exp://**', `http://localhost:${env.PORT}`] : []),
    // The web app: app.sendraa.tech, and localhost on any port against a development API.
    ...trustedWebOrigins(request),
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: 15 * 60,
    revokeSessionsOnPasswordReset: true,
    ...(recoveryConfigured ? { sendResetPassword: async ({ user, token }: { user: { id: string; email: string; emailVerified: boolean }; token: string }) => sendPasswordReset(user, token) } : {}),
  },
  account: {
    // Cloudflare refresh tokens can change DNS and deploy Workers in the
    // customer's account, so they are encrypted at rest.
    encryptOAuthTokens: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    freshAge: 15 * 60,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/sign-in/oauth2': { window: 60, max: 10 },
      '/sign-in/social': { window: 60, max: 10 },
      '/request-password-reset': { window: 60, max: 3 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-in/email' || ctx.path === '/request-password-reset') {
        const email = String(ctx.body?.email ?? '').trim().toLowerCase();
        if(await one('select 1 from mailbox m join "user" u on u.id=m.account_user_id where lower(u.email)=$1 and m.deleting_at is not null',[email])) {
          throw new APIError('UNAUTHORIZED',{message:'This work account is being deleted.'});
        }
        const alias = await one<{ email: string }>(
          `select u.email from login_alias a join "user" u on u.id = a.user_id
           join mailbox m on m.id = a.mailbox_id
           join tenant_member tm on tm.tenant_id = m.tenant_id and tm.user_id = u.id
           where a.address = $1 and not m.shared and m.deleting_at is null and m.owner_user_id=u.id
           and not exists (select 1 from "user" direct where lower(direct.email) = $1)`, [email],
        );
        if (alias && ctx.body) ctx.body.email = alias.email;
      }
      if (ctx.path !== '/sign-up/email') return;
      // Password sign-up is only for accepting an invite, and only for the invited address.
      const token = ctx.headers?.get(INVITE_HEADER) ?? '';
      if (!token && devAdminSignup) return;
      const invite = token ? await findOpenInvite(token) : null;
      if (invite?.separate_account) {
        throw new APIError('FORBIDDEN', { message: 'Create your work login by accepting the mailbox invitation in Sendraa.' });
      }
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase();
      if (!invite || invite.email.toLowerCase() !== email) {
        throw new APIError('FORBIDDEN', { message: 'Accounts are created from an invite. Ask your workspace admin for one.' });
      }
    }),
  },
  plugins: [
    rememberDeviceSession(),
    multiSession({ maximumSessions: 5 }),
    // Serialize all session cookies into the native OAuth return after multi-session adds them.
    expo(),
    ...(env.PASSKEY_RP_ID ? [passkey({
      rpID: env.PASSKEY_RP_ID,
      rpName: 'Sendraa',
      origin: [`https://${env.PASSKEY_RP_ID}`, new URL(env.BETTER_AUTH_URL).origin, ...androidPasskeyOrigins(androidSigningFingerprints)],
    })] : []),
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
