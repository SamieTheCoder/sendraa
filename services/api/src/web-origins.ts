import { env, isDev } from './env.js';

/**
 * Browsers the web app runs in. Native apps send no Origin header and are not affected.
 *
 * - Always: every origin in WEB_ORIGINS (production default https://app.sendraa.tech).
 * - Development API only: http(s)://localhost and 127.0.0.1 on any port, so `expo start --web`
 *   works whatever port Metro picks. A production API never accepts localhost.
 */
const configured = new Set(
  env.WEB_ORIGINS.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
);
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function isWebOrigin(origin: string | null | undefined): origin is string {
  if (!origin) return false;
  return configured.has(origin) || (isDev && LOCAL.test(origin));
}

/** For better-auth's trustedOrigins: the configured list, plus this request's origin when allowed. */
export function trustedWebOrigins(request?: Request): string[] {
  const origin = request?.headers.get('origin');
  return [...configured, ...(isWebOrigin(origin) && !configured.has(origin) ? [origin] : [])];
}

/**
 * Whether session cookies are sent on cross-site requests (SameSite=None).
 *
 * app.sendraa.tech and api.sendraa.tech are the same site, so production keeps the default
 * SameSite=Lax. localhost and api-dev.sendraa.tech are different sites, so the development API
 * needs SameSite=None for a localhost web app to stay signed in. WEB_CROSS_SITE_COOKIES overrides.
 */
export const crossSiteCookies = env.WEB_CROSS_SITE_COOKIES ? env.WEB_CROSS_SITE_COOKIES === 'true' : isDev;
