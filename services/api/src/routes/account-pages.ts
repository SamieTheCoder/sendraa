import { Hono } from 'hono';
import { legalDocuments, LEGAL_VERSION } from '../../../../apps/mobile/src/content/legal.js';

export const accountPages = new Hono();
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (title: string, content: string, script = '') => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)} · Sendraa</title><style>
:root{color-scheme:light dark;font:16px/1.6 system-ui;background:light-dark(#f6f6f4,#101010);color:light-dark(#181818,#f5f5f5)}*{box-sizing:border-box}main{max-width:720px;margin:auto;padding:40px 24px 64px}a{color:inherit}header{font-weight:800;margin-bottom:40px}h1{font-size:32px;line-height:1.15;letter-spacing:-.03em}h2{font-size:20px;margin-top:32px}p{margin:12px 0 24px}label{display:block;margin:18px 0 6px}input,button{font:inherit;width:100%;padding:14px 16px;border-radius:12px}input{border:1px solid #888;background:transparent;color:inherit}button{background:#f5c400;color:#16130e;border:0;font-weight:650;margin-top:24px;cursor:pointer}button:disabled{opacity:.5}footer{margin-top:48px;font-size:14px}#status{min-height:24px}nav{display:flex;gap:24px}small{opacity:.75}</style><main><header>sendraa</header><h1>${escape(title)}</h1>${content}<footer><nav><a href="/legal/privacy">Privacy Policy</a><a href="/legal/terms">Terms of Service</a></nav></footer></main>${script ? `<script>${script}</script>` : ''}</html>`;
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
