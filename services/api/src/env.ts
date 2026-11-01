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
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  MAX_OPEN_INVITES: z.coerce.number().int().positive().default(50),
  /**
   * Local development only: lets a password account create a workspace, so
   * the API can be exercised before a Cloudflare OAuth client exists.
   * Refused in production.
   */
  ALLOW_DEV_ADMIN_SIGNUP: z.enum(['true', 'false']).default('false'),
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
