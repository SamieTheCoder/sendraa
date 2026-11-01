/**
 * OAuth scopes requested during tenant onboarding.
 *
 * These identifiers were read from the live API, not inferred:
 *
 *   GET https://api.cloudflare.com/client/v4/oauth/scopes
 *
 * Re-check with `CF_API_TOKEN=... pnpm --filter @sendraa/cloudflare scopes`.
 * Scopes are dot-delimited; the client-creation API rejects colon-delimited
 * names and fails outright on an unknown scope.
 */

/** OIDC protocol scopes. `offline_access` is what yields a refresh token. */
export const PROTOCOL_SCOPES = ['openid', 'offline_access'] as const;

/**
 * Who the admin is. Cloudflare's OIDC returns only `sub` and does not know the
 * `email` or `profile` scopes (its consent screen rejects them), so the email
 * and name come from GET /user, which needs `user-details.read`.
 */
export const IDENTITY_SCOPES = ['user-details.read'] as const;

/**
 * Scopes provisioning cannot work without. These are marked required on the
 * OAuth client, so the consent screen does not allow declining them.
 */
export const REQUIRED_SCOPES = [
  // Discover which zones the tenant can use
  'zone.read',

  // Turn on Email Routing for the zone (POST /zones/:id/email/routing/dns)
  // and read its status. Cloudflare files this under Zone Settings.
  'zone-settings.read',
  'zone-settings.write',

  // Write MX, SPF, DMARC and the ownership-verification TXT record
  'dns.read',
  'dns.write',

  // Install the catch-all rule that points the domain at the Worker
  'email-routing-rule.read',
  'email-routing-rule.write',

  // Deploy and update the sendraa-mail Worker, including fleet upgrades
  'workers-scripts.read',
  'workers-scripts.write',

  // Mail metadata store
  'd1.read',
  'd1.write',

  // Raw MIME and attachment store
  'workers-r2.read',
  'workers-r2.write',
] as const;

/**
 * Scopes the user may decline without breaking inbound mail.
 *
 * Declining these degrades specific features rather than blocking onboarding:
 * sending detection, the free verified-destination path, and direct object
 * access for deferred parsing of oversized messages.
 */
export const OPTIONAL_SCOPES = [
  // Detect whether the account is entitled to Email Sending (Workers Paid),
  // then configure the sending domain if it is
  'email-sending.read',
  'email-sending.write',

  // Verified destination addresses: the free-send path and the mechanism for
  // auto-confirming Cloudflare's own verification mails
  'email-routing-address.read',
  'email-routing-address.write',

  // Platform-side reads of raw MIME when a message was too large to parse
  // inside the Worker's CPU budget
  'workers-r2-bucket-item.read',

  // Account name for display in the tenant switcher
  'account-settings.read',
] as const;

export function onboardingScopes(): readonly string[] {
  return [...PROTOCOL_SCOPES, ...IDENTITY_SCOPES, ...REQUIRED_SCOPES, ...OPTIONAL_SCOPES];
}

/** Scope set for the OAuth client registration payload. */
export function clientRegistrationScopes(): {
  scopes: readonly string[];
  optional_scopes: readonly string[];
} {
  return {
    scopes: onboardingScopes(),
    optional_scopes: OPTIONAL_SCOPES,
  };
}
