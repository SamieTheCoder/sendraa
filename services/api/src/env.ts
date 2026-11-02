import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1),
  /** Public URL of this API, used for OAuth callbacks. */
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  /** Cloudflare OAuth client. Without it, admin sign-in is unavailable and the API says so. */
  CLOUDFLARE_CLIENT_ID: z.string().optional(),
  CLOUDFLARE_CLIENT_SECRET: z.string().optional(),
  APP_SCHEME: z.string().default('sendraa'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  PASSKEY_RP_ID: z.string().optional(),
  APPLE_APP_ID: z.string().optional(),
  ANDROID_PACKAGE: z.string().default('com.scientificsamie.sendraa'),
  ANDROID_SHA256_FINGERPRINTS: z.string().default(''),
  /** Only enable behind a Cloudflare Tunnel with an origin inaccessible to clients. */
  TRUST_CLOUDFLARE_PROXY: z.enum(['true', 'false']).default('false'),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  MAX_OPEN_INVITES: z.coerce.number().int().positive().default(50),
  /**
   * Local development only: lets a password account create a workspace, so
   * the API can be exercised before a Cloudflare OAuth client exists.
   * Refused in production.
   */
  ALLOW_DEV_ADMIN_SIGNUP: z.enum(['true', 'false']).default('false'),
  /**
   * Comma-separated origins of the web app, allowed to call the API from a browser with cookies.
   * A development API also allows localhost on any port (see web-origins.ts).
   */
  WEB_ORIGINS: z.string().default('https://app.sendraa.tech'),
  /** Send session cookies cross-site (SameSite=None). Defaults to on in development, off in production. */
  WEB_CROSS_SITE_COOKIES: z.enum(['true', 'false']).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment:\n${issues}`);
}

export const env = parsed.data;
export const isDev = env.NODE_ENV !== 'production';
if (parsed.data.NODE_ENV === 'production' && parsed.data.ALLOW_DEV_ADMIN_SIGNUP === 'true') {
  throw new Error('ALLOW_DEV_ADMIN_SIGNUP must not be enabled in production.');
}
export const devAdminSignup = parsed.data.ALLOW_DEV_ADMIN_SIGNUP === 'true';
export const cloudflareConfigured = Boolean(env.CLOUDFLARE_CLIENT_ID && env.CLOUDFLARE_CLIENT_SECRET);
export const recoveryConfigured = Boolean(env.SMTP_USER && env.SMTP_PASSWORD);
