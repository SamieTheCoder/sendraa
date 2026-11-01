/**
 * OAuth scopes requested during tenant onboarding.
 *
 * IMPORTANT: scope identifiers are NOT guessable. They correspond to Cloudflare
 * API token permission names and must be read from the live API:
 *
 *   curl https://api.cloudflare.com/client/v4/oauth/scopes \
 *     -H "Authorization: Bearer $CF_API_TOKEN"
 *
 * Run `pnpm --filter @sendraa/cloudflare scopes` to print them. The values below
 * are placeholders describing the *capabilities* we need, to be replaced with
 * real scope IDs once discovered. Dot-delimited form is expected; colon-delimited
 * scopes are rejected by the client-creation API.
 */

/** Capabilities provisioning requires, as a checklist to map onto real scope IDs. */
export const REQUIRED_CAPABILITIES = [
  'read account list',
  'read zone list',
  'edit DNS records',
  'edit Email Routing rules and addresses',
  'edit Email Routing settings',
  'create and edit D1 databases',
  'create and edit R2 buckets',
  'upload and edit Workers scripts',
] as const;

/** OIDC protocol scopes. `offline_access` is what yields a refresh token. */
export const PROTOCOL_SCOPES = ['openid', 'offline_access'] as const;

/**
 * Placeholder resource scopes. Replace with verified IDs from the scopes endpoint
 * before the OAuth client is created; an unknown scope fails client creation.
 */
export const RESOURCE_SCOPES: readonly string[] = [
  // e.g. 'workers-platform.write', 'dns.write', 'email-routing.write', ...
];

export function onboardingScopes(): readonly string[] {
  return [...PROTOCOL_SCOPES, ...RESOURCE_SCOPES];
}
