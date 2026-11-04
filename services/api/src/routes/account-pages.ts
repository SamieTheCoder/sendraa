import { readFile } from 'node:fs/promises';
import { env } from '../env.js';
import { findOpenInvite } from '../invites.js';
import { Hono } from 'hono';
import { legalDocuments, LEGAL_VERSION } from '../../../../apps/mobile/src/content/legal.js';

export const accountPages = new Hono();
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (title: string, content: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)} · Sendraa</title><meta name="application-name" content="Sendraa"><meta name="apple-mobile-web-app-title" content="Sendraa"><meta name="theme-color" content="#16130e"><link rel="icon" href="/favicon.ico" sizes="192x192"><link rel="icon" type="image/png" sizes="192x192" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest"><style>
:root{color-scheme:light dark;font:16px/1.6 system-ui;background:light-dark(#f6f6f4,#101010);color:light-dark(#181818,#f5f5f5)}*{box-sizing:border-box}main{max-width:720px;margin:auto;padding:40px 24px 64px}a{color:inherit}header{font-weight:800;margin-bottom:40px}header a{display:inline-flex;align-items:center;gap:12px;text-decoration:none}header img{border-radius:12px}h1{font-size:32px;line-height:1.15;letter-spacing:-.03em}h2{font-size:20px;margin-top:32px}p{margin:12px 0 24px}label{display:block;margin:18px 0 6px}input,button{font:inherit;width:100%;padding:14px 16px;border-radius:12px}input{border:1px solid #888;background:transparent;color:inherit}button{background:#f5c400;color:#16130e;border:0;font-weight:650;margin-top:24px;cursor:pointer}button:disabled{opacity:.5}footer{margin-top:48px;font-size:14px}#status{min-height:24px}nav{display:flex;gap:24px}small{opacity:.75}</style></head><body><main><header><a href="/" aria-label="Sendraa home"><img src="/assets/sendraa-logo.png" width="48" height="48" alt="">Sendraa</a></header><h1>${escape(title)}</h1>${content}<footer><nav><a href="/legal/privacy">Privacy Policy</a><a href="/legal/terms">Terms of Service</a></nav></footer></main>${script ? `<script>${script}</script>` : ''}</body></html>`;
accountPages.get('/', (c) => c.html(page('Your mail. Your workspace.', '<p>Sendraa keeps your workspace mail connected across your devices.</p><p>Open the Sendraa app to sign in, manage your account, and read your mail.</p>')));
accountPages.get('/site.webmanifest', (c) => c.json({
  name: 'Sendraa', short_name: 'Sendraa', start_url: '/', display: 'browser',
  background_color: '#16130e', theme_color: '#16130e',
  icons: [{ src: '/favicon.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/sendraa-logo.png', sizes: '1024x1024', type: 'image/png' }],
}, 200, { 'Content-Type': 'application/manifest+json' }));
for (const path of ['/favicon.png', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.ico']) {
  accountPages.get(path, async (c) => {
    const png = await readFile(new URL('../../../../apps/mobile/assets/images/favicon.png', import.meta.url));
    if (path === '/favicon.ico') {
      // ICO supports PNG image payloads; keep the exact existing brand artwork.
      const header = Buffer.alloc(22);
      header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
      header[6] = 192; header[7] = 192;
      header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
      header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
      return c.body(new Uint8Array(Buffer.concat([header, png])), 200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400' });
    }
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  });
}
accountPages.get('/legal/:document', (c) => {
  const key = c.req.param('document');
  if (key !== 'privacy' && key !== 'terms') return c.notFound();
  const doc = legalDocuments[key];
  return c.html(page(doc.title, `<small>Updated ${LEGAL_VERSION}</small><p>${escape(doc.intro)}</p>${doc.sections.map((s) => `<section><h2>${escape(s.title)}</h2><p>${escape(s.text)}</p></section>`).join('')}`));
});
accountPages.get('/account/reset', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.html(page('Choose a new password', '<p>Use 10–128 characters. Your other sessions will be signed out.</p><form id="reset"><label for="password">New password</label><input id="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required><label for="confirm">Confirm password</label><input id="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required><button id="submit">Save new password</button><p id="status" role="status"></p></form>', `
const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
const form = document.getElementById('reset'), status = document.getElementById('status'), button = document.getElementById('submit');
if (!token) { status.textContent = 'This link is missing or expired. Request a new reset email from Sendraa.'; button.disabled = true; }
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  const password = document.getElementById('password').value;
  if (password !== document.getElementById('confirm').value) { status.textContent = 'The passwords do not match.'; return; }
  button.disabled = true; status.textContent = 'Saving…';
  try {
    const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword: password }) });
    if (!response.ok) { status.textContent = response.status === 429 ? 'Too many attempts. Wait a minute and retry.' : 'This link is invalid or expired. Request a new reset email.'; button.disabled = false; return; }
    form.reset(); status.textContent = 'Password saved. Return to Sendraa and sign in with your new password.';
  } catch { status.textContent = 'Could not connect. Your password has not been confirmed. Retry when you are online.'; button.disabled = false; }
});`));
});

accountPages.get('/assets/sendraa-logo.png', async (c) => {
  const logo = await readFile(new URL('../../../../apps/mobile/assets/images/icon.png', import.meta.url));
  return c.body(new Uint8Array(logo), 200, {'content-type':'image/png','cache-control':'public, max-age=86400'});
});

accountPages.get('/invite/:token', async (c) => {
  c.header('Cache-Control','private, no-store');
  c.header('Referrer-Policy','no-referrer');
  const token = c.req.param('token');
  const invite = await findOpenInvite(token);
  if (!invite) return c.html(page('Invitation unavailable', '<p>This invitation has expired, been used, or been withdrawn. Ask your workspace admin for a new one.</p>'), 404);
  const appLink = `${env.APP_SCHEME}://invite/${token}`;
  return c.html(page(`Join ${invite.tenant_name}`, `<p>This invitation is for <strong>${escape(invite.email)}</strong>. Open Sendraa to choose your password and join your workspace.</p><p><a style="display:inline-block;background:#f5c400;color:#16130e;padding:14px 22px;border-radius:12px;font-weight:bold;text-decoration:none" href="${escape(appLink)}">Open invitation in Sendraa</a></p><p>If Sendraa is not installed, ask your administrator for the app’s installation link, then reopen this invitation.</p><p><small>Your personal email is your sign-in account. Your assigned work mailbox will appear after you accept.</small></p>`));
});
