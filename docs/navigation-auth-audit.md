# Navigation, authentication and domain audit

## Scope and evidence

Impeccable native source audit followed by Interface Design refinement, 2026-11-02. Evidence: supplied Android consent screenshot, earlier iOS settings screenshots, current source, Expo SDK 58 docs, Cloudflare's task-based OAuth documentation. No booted iOS simulator is available; native layout, screen-reader traversal and large-font behavior are not runtime-verified.

## Design brief

Intent: a domain owner checks mail and manages a team without repeating setup. Calm, familiar native navigation; preserve the requested bottom bar.
Domain: inbox, mailbox, domain, sender identity, delivery, workspace, ownership.
Color world: paper white, ink black, envelope grey, Sendraa yellow, delivery-error red.
Signature: Sendraa yellow marks the active mailbox and primary action; mailbox addresses remain visible context.
Rejecting: replacement navigation → existing native tabs; decorative large headers → compact native titles; identical setup/login journeys → separate authentication from infrastructure consent.
Hierarchy: compact screen title, primary row text, secondary values and explanatory footers.
Palette/depth/surfaces: existing semantic light/dark tokens and grouped tonal surfaces, no new palette or decorative shadows.
Typography: native system body 17, supporting text 14, weight and semantic color carry hierarchy.
Spacing: 4-point base; grouped rows at least 48 high, growing with text. Buttons retain 54 minimum height.

## Platform conformance verdict

Source-level partial pass. Native stacks/tabs and switches are preserved. Native device verification remains outstanding; this is not a claim of a fully validated platform experience.

| Dimension | Provisional score /4 | Evidence / remaining limitation |
|---|---:|---|
| Accessibility | 3 | Fixed loading-button labels, selection semantics, clipped row values and short row targets; screen-reader traversal untested |
| Performance | 3 | Fixed stale account-domain responses; no device profiling |
| Appearance | 3 | Semantic colors and compact opaque headers; light/dark screenshots still required |
| Platform conformance | 3 | Restored native search role and scroll minimization; retained top-bar fix |
| Adaptivity | 2 | Text can grow; tablet, landscape and large text need native verification |
| Total | 14/20 | Provisional Good; source review only |

## Findings and fixes

- P1, navigation: `(tabs)/_layout.tsx` changed the requested bottom navigation. Restored `minimizeBehavior="onScrollDown"` and search role. Top stacks retain compact nontransparent titles. Command: impeccable polish.
- P1, onboarding data integrity: `onboarding.tsx` could display an old account's domains after a quick selection change. Ignore stale responses; selecting the same account no longer leaves an indefinite spinner. Command: impeccable harden.
- P2, accessibility: grouped rows and account choices were 46 high, below Android's 48 minimum. Increased and added vertical space to account rows. Command: impeccable adapt.
- P2, accessibility: button label disappeared while loading. Stable accessibility label now names the action. Long button labels shrink within the row and wrap. Command: impeccable harden.
- P2, accessibility: settings values truncated and selection used checkbox semantics on buttons. Values wrap; selection uses selected state. Command: impeccable adapt.
- P2, onboarding clarity: copy implied immediate login without provider consent and unqualified multi-domain readiness. Clarified actual behavior and current one-domain limit. Command: impeccable clarify.

Positive patterns: shared controls, semantic color tokens, platform-native navigation and switches, authenticated permission checks, existing mailbox/domain ownership model. Preserve these. Final command: impeccable polish, with native device verification still required.

## Why Cloudflare shows consent again

`services/api/src/auth.ts` configures the Cloudflare provider with `onboardingScopes()` for every sign-in. There is no explicit `prompt=consent` in app code. A completed workspace does not change the OAuth request. The screenshot proves a consent screen occurred, but not why Cloudflare chose to show it for this particular grant/session.

The unverified-domain warning concerns the OAuth client's registered application domain, not the customer's provisioned email domain. The registration script intentionally creates a development client. Do not make it public or change its identity incidentally.

Cloudflare supports requesting a subset of registered scopes: https://blog.cloudflare.com/task-based-oauth-consent/ . Recommended implementation is a distinct identity-only sign-in flow (`openid`, `user-details.read`) and a signed-in connect/reconnect flow for provisioning scopes. Preserve the existing privileged refresh token separately: simply shrinking scopes on the same Better Auth account risks replacing the token used for provisioning. Link by verified provider subject, never by an untrusted email supplied by the app. Test returning-user login, first-time connect, revoked grant, declined permissions and token preservation before enabling this change. No consent bypass has been implemented in this UI refinement.

Until then, password/passkey login uses Sendraa authentication without invoking Cloudflare consent. Passkeys still require the configuration in account-security.md.

## Multi-domain implementation preparation

Recommended UI: Settings → Domains → connected-domain list. Each row shows its name, receiving/sending status and mailbox count; domain detail owns setup errors, retry and mailbox creation. Add domain lists eligible zones in the workspace's Cloudflare account, previews affected email routing and connects one selected domain at a time. Never silently connect every zone. Keep a domain selector in mailbox creation and compose sender selection. A failure adding a second domain must not block existing mail.

Current backend has domain and mailbox relationships, but POST setup explicitly rejects a second connected domain; setup status and provision_step are tenant-scoped. Removing that guard alone is unsafe.

Implementation order:
1. Migrate per-domain status, error and step progress, backfilling the existing ready domain. Keep account-level Worker/D1/R2 provisioning progress separate.
2. Add idempotent domain-connect jobs with per-workspace locking; verify zone belongs to the linked Cloudflare account and cannot move between tenants via an upsert conflict.
3. Reuse existing Worker and storage; run DNS/routing/mailbox steps for the selected domain only. Do not rotate the tenant secret or rerun account setup unnecessarily.
4. Preserve tenant mail availability while a new domain is pending/failed. Expose per-domain status and retries in the API/UI.
5. Paginate Cloudflare zones (current list requests only 50), distinguish inactive/already-connected zones, preserve existing foreign MX safeguards and explain catch-all routing changes.
6. Test two domains, same local-part addresses, partial failure, concurrent connect, retry, permission revocation, cross-tenant conflicts and mailbox access isolation. Verify inbound and sender selection independently for each domain.

No production Cloudflare resources or OAuth grants were changed in this pass.
