# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

- **Admin:** a startup founder or early team lead who owns a domain on Cloudflare and wants professional addresses (`name@theirstartup.com`) without paying per seat. Signs in with Cloudflare, connects the domain, creates mailboxes, and invites the team.
- **Member:** staff at that startup. Has no Cloudflare account. Receives an emailed invite, sets a password, and uses only the mailboxes assigned to them.

## Product Purpose

A Gmail-like mail app for iOS, Android and web, on the customer's own domain. Sendraa provisions mail infrastructure (Email Routing, a Worker, D1, R2) inside the admin's own free Cloudflare account, so receiving mail is free and unlimited. Sendraa starts as a free platform and charges later for extra features.

## Positioning

Mail lives in the customer's own Cloudflare account, set up from a single Cloudflare sign-in. Compared with self-hosted tools such as Mailflare, there is nothing to deploy and no per-seat bill. Receiving is always free.

## Operating Context

- Onboarding: "Continue with Cloudflare" (OIDC) → pick domain → automatic provisioning → `admin@theirdomain` is created automatically.
- Sending setup offers two options: Cloudflare Email Sending (Workers Paid, $5/month paid to Cloudflare, 3,000 emails/month included, aligned DKIM) or a Gmail app password the user generates and pastes (free, 500/day, sends via Gmail and is not DKIM-aligned to the custom domain).
- Member invites are sent from `admin@theirdomain` through the tenant's own sending setup, with a copyable invite link as the fallback.

## Capabilities and Constraints

- Inbound mail is free and unlimited; outbound requires one of the two sending options.
- The tenant Worker does ingest and a thin JSON API only. No rendering happens in the Worker.
- Undecided: platform domain (`sendraa.app` or `maildrift.org`), pricing for paid features.

## Brand Commitments

- Name: **Sendraa**. App URL scheme `sendraa://`. Wordmark casing is not decided.
- Brand file format follows `agreementoo-brand.html`: switchable logo concepts and color schemes with live previews of the invite email and the icons.
- The app UI follows Apple's design (stated by the user): system controls, SF Pro, SF Symbols and system colours. The brand appears only as the accent (tint) colour, the app icon, and the wordmark on the sign-in screen. App screens are not part of the brand board.
- No final logo or palette has been chosen yet.

## Evidence on Hand

No customers, testimonials, usage numbers or pricing exist. Do not invent them. Demo content must be labelled as sample data.

## Product Principles

1. Onboarding friction is the product. Every step a founder would otherwise read a tutorial for should be one tap.
2. The customer owns their mail. Data stays in their Cloudflare account.
3. Be honest about sending. Show the real cost and trade-off of each option.
4. Native first. iOS and Android users should feel at home on each platform.
