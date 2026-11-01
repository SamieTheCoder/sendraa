import { addressParser } from 'postal-mime';

export type Addr = { name: string; address: string };

/** Unwraps groups and drops entries without an address. */
export function flatAddresses(input: readonly { name: string; address?: string; group?: { name: string; address: string }[] }[] | undefined): Addr[] {
  const out: Addr[] = [];
  for (const a of input ?? []) {
    if (a.group) out.push(...a.group.map((m) => ({ name: m.name, address: m.address.toLowerCase() })));
    else if (a.address) out.push({ name: a.name, address: a.address.toLowerCase() });
  }
  return out;
}

export function parseAddressHeader(value: string | null): Addr[] {
  return value ? flatAddresses(addressParser(value, { flatten: true })) : [];
}

/** `<a@b>` → `a@b`. */
export function stripAngles(id: string | null | undefined): string | null {
  const v = id?.trim();
  if (!v) return null;
  return v.replace(/^<|>$/g, '') || null;
}

/** All Message-IDs in a References header, oldest first. */
export function parseReferences(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...value.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]!).slice(-50);
}

/** `alice+news@x.com` → `alice@x.com`, so plus-addressing reaches the mailbox. */
export function baseAddress(address: string): string {
  const [local = '', domain = ''] = address.toLowerCase().split('@');
  return `${local.split('+')[0]}@${domain}`;
}

const SNIPPET_LENGTH = 160;

export function snippetFrom(text: string | undefined, html: string | undefined): string {
  let source = text;
  if (!source && html) {
    // Cheap tag strip. Rendering belongs to the app; this only feeds the list preview.
    // Block tags become spaces so words do not run together; inline tags vanish.
    source = html
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/?(p|div|br|li|tr|td|th|h[1-6]|table|ul|ol|blockquote|section|article)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }
  return (source ?? '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH);
}

export function parseDate(value: string | null | undefined, fallback: number): number {
  const t = value ? Date.parse(value) : Number.NaN;
  // Ignore dates far in the future; senders get clocks wrong.
  return Number.isFinite(t) && t < fallback + 24 * 60 * 60 * 1000 ? t : fallback;
}

const encoder = new TextEncoder();

/** Constant-time comparison. Both sides are hashed first so length does not leak. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function log(level: 'info' | 'error', message: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ message, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}
