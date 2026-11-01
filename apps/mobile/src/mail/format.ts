import type { Address } from './types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Inbox-style time: "9:41 AM" today, "Yesterday", weekday this week, otherwise a short date. */
export function listTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = date.getTime();

  if (t >= startOfToday) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (t >= startOfToday - DAY) return 'Yesterday';
  if (t >= startOfToday - 6 * DAY) return date.toLocaleDateString(undefined, { weekday: 'short' });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Full timestamp shown on an expanded message. */
export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

export function displayName(a: Address): string {
  return a.name.trim() || a.address;
}

export function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

/** Parses "Name <a@b.c>, d@e.f" into addresses. Unparseable entries are dropped. */
export function parseAddresses(input: string): Address[] {
  return input
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const angled = part.match(/^(.*)<([^>]+)>$/);
      if (angled) return { name: angled[1]!.trim().replace(/^"|"$/g, ''), address: angled[2]!.trim() };
      return { name: '', address: part };
    })
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.address));
}

/** The last fragment of a comma-separated recipient field, used for suggestions. */
export function trailingToken(input: string): string {
  const parts = input.split(/[,;]/);
  return parts[parts.length - 1]!.trim();
}

export function replaceTrailingToken(input: string, address: string): string {
  const parts = input.split(/[,;]/);
  parts[parts.length - 1] = ` ${address}`;
  return `${parts.join(',').replace(/^\s+/, '')}, `;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One-line preview with whitespace collapsed. */
export function snippet(body: string): string {
  return body
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripPrefix(subject: string): string {
  return subject.replace(/^((re|fwd?|aw)\s*:\s*)+/i, '');
}
