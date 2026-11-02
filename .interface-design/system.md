# Sendraa interface system

Sendraa is a mail app for small teams on their own domain, with mail stored in the team's own
Cloudflare account. People open it to read and send mail. Admins also open it to set up the domain and
invite people. The app follows Apple's design. The brand appears in only a few places: the tint, the
app icon and splash, the sign-in mark, and one yellow action per screen.

Source of truth for colour: `apps/mobile/src/theme/colors.ts` (`useColors()`).
Brand board: `brand/sendraa-brand.html`. Telegram scheme, Strip logo.

## Direction

- Calm, plain and system-native. It should feel like iOS Settings and Mail, with a telegram's
  directness: short sentences and one clear action.
- Dark mode is a true dark ground (iOS `systemBackground`, black). Every full screen, sign-in
  included, uses the same `background` token, so there are no separately tinted brand screens.
- Light mode uses the same layouts on system light colours.

## Colour

| Token | Use |
| --- | --- |
| `background` | Every full-screen ground, sign-in included |
| `groupedBackground` / `cell` | Settings-style grouped lists and their cards |
| `label` / `secondaryLabel` / `tertiaryLabel` | Text, in three levels. Running text is `label` |
| `tint` | What you tap: links, plain buttons, the selected tab. Amber `#7A5400` in light, yellow `#F5C400` in dark |
| `Brand.yellow` with `Brand.ink` text | The one primary action per screen (`Button variant="brand"`), app icon, splash, sign-in tile |
| `inputFill` / `inputBorder` | Text boxes only. The border is at least 3:1 against its surface |
| `soft` | Pale yellow behind `AddressStrip` |
| `green` / `orange` / `red` | Status only: ready, in progress, error. Always paired with an icon or a word |
| `fill` | Pressed rows and icon tiles |

Never put yellow text on white. Never use colour as the only signal.

## Depth

Surface colour steps only, no shadows on things at rest. Cards are `cell` on `groupedBackground`.
Text boxes are the one bordered element: a 1.5pt `inputBorder` that turns `tint` while focused and
`red` when invalid.

## Type

SF Pro (system) everywhere. League Gothic is used only in `Wordmark`.

| Role | Size / weight |
| --- | --- |
| Screen title (sign-in) | 30 / 700, tracking -0.6 |
| Profile name | 20–22 / 700 |
| Card title | 17 / 600 |
| Field label, group heading | 15 / 600, sentence case (no uppercase labels) |
| Body | 15–17 / 400, line height about 1.4 |
| Caption, legal | 12–14 / 400 |

## Spacing and shape

- Base unit 4. Screen margins are 24 on sign-in and 16 on grouped screens.
- Radius: text boxes and buttons 12, compact buttons 10, cards 16, icon tiles 8–9, the sign-in tile 16.
- Controls are at least 44 tall. Buttons and text boxes are 52.

## Components (`apps/mobile/src/components`)

- `TextBox` and `Field` (form.tsx): `Field` puts a 15/600 label 8 above a 52-tall box. Password
  fields get a Show/Hide button inside the box. Pass `invalid` to outline the box in red.
- `Button` (form.tsx): variants are `brand` (yellow, once per screen), `ink` (inverse of the page,
  for "Continue with" sign-in), `filled` (tint), `outline` and `plain`. Sizes are `regular` (52)
  and `compact` (44). `leading` takes an icon. Pressing scales to 0.98.
- `ErrorText` / `NoticeText`: a red error icon or a green check, with the message.
- `CloudflareButton`: the `ink` Button with `assets/images/cloudflare.svg`, which keeps the orange
  cloud on both ink and paper.
- `Mark` / `Wordmark` / `Lockup` (logo.tsx): `Mark` is one white PNG (`assets/images/mark.png`)
  tinted at runtime.
- `AddressStrip`: the signed-in address on a pale-yellow strip with the Strip mark's scissor cut.
  Used on the Settings profile card and on Account and security.
- `Section` / `Row` / `SwitchRow` (grouped-list.tsx): inset grouped lists. `Row icon` adds a 30pt
  grey tile with a glyph. Pass `inset="icon"` on the Section so separators line up with the titles.
  `valueColor` colours status values.

## Screens

- **Sign-in**: one centred column that fits a phone screen with no scrolling. From top to bottom:
  yellow tile with the ink Mark, "Welcome back" and a one-line subtitle, `CloudflareButton`, an "or"
  divider, Email and Password fields with placeholders, a right-aligned "Forgot password?", the
  yellow Sign in button, an optional passkey text button, and a one-line legal footer at the bottom.
  Keep text to a minimum here.
- **Settings**: a profile card first (avatar, name, `AddressStrip`, sign-in method) that opens
  Account and security. Then Workspace, Mailboxes, the current mailbox, Inbox, "Sending and alerts"
  and About, with Sign out as a red row on its own. The Lockup and version number sit at the bottom.
- **Account and security**: identity at the top, then a "Ways to sign in" group (Cloudflare,
  Password, Passkeys) and a Recovery group. Each method is a card with a tile icon, a status dot and
  label, one line of explanation, and one outline action.

## Behaviour rules

- Only the first session check may show the launch spinner (`sessionKnown` in `app/_layout.tsx`).
  better-auth refetches the session whenever the app becomes active. Password autofill and Face ID
  make the app inactive for a moment, so gating on every refetch unmounted the sign-in form.
- Tapping the Search tab focuses the search bar and raises the keyboard.

## Web

- Production: the web app is `https://app.sendraa.tech` and calls the API at `api.sendraa.tech`
  (set `EXPO_PUBLIC_API_URL` at web build time). Both are the same site, so the session is a normal
  first-party `SameSite=Lax` cookie.
- Development: `expo start --web` on localhost (any port) calls `api-dev.sendraa.tech`. Only the
  development API allows localhost, and it issues `SameSite=None; Secure` cookies.
- Session on web: the browser's cookie jar (`credentials: 'include'`). Never set a `cookie` header,
  because browsers drop it. Use `sessionInit()` from `lib/api.ts`.
- OAuth return URLs: use `authReturnURL(path)` from `lib/auth-client.ts`. On web it is the page's own
  origin. On native it stays an app path.
- Colour scheme: use `useScheme()` from `theme/colors.ts`, never react-native's `useColorScheme`.
  On web it reports light until hydration so the server HTML matches the client.
- Nothing iOS-only (`DynamicColorIOS`, `Color.ios.*`) may run when a module loads. The web server
  renderer evaluates these modules too.

## Assets

`assets/images` holds only what is used: the app icons (light, dark, tinted, Android adaptive), the
splash icons, the favicon, `mark.png` and `cloudflare.svg`. Regenerate the PNGs with
`node brand/icons/render.mjs`.
