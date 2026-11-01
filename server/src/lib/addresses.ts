export interface SplitAddress {
  localPart: string;
  /** Local part with any `+tag` suffix removed, used for mailbox matching. */
  baseLocalPart: string;
  tag: string | null;
  domain: string;
}

/**
 * Splits an envelope address into the parts needed for routing.
 *
 * Addresses are lowercased because we match them against citext columns and
 * every practical mail host treats the domain, and in reality the local part
 * too, case-insensitively.
 */
export function splitAddress(address: string): SplitAddress | null {
  const trimmed = address.trim().replace(/^<|>$/g, '').toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;

  const localPart = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain.includes('.') || domain.includes(' ') || localPart.includes(' ')) return null;

  // RFC 5233 subaddressing: everything after the first '+' is a tag that must
  // not affect which mailbox the message lands in, but is preserved for rules.
  const plus = localPart.indexOf('+');
  const baseLocalPart = plus > 0 ? localPart.slice(0, plus) : localPart;
  const tag = plus > 0 ? localPart.slice(plus + 1) : null;

  return { localPart, baseLocalPart, tag, domain };
}

/**
 * Normalises a subject for subject-based thread fallback matching.
 * Strips any number of stacked reply/forward prefixes.
 */
export function normaliseSubject(subject: string | undefined | null): string {
  if (!subject) return '';
  let s = subject.trim();
  let changed = true;
  while (changed) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|antw)\s*(\[\d+\])?\s*:\s*/i, '');
    changed = next !== s;
    s = next;
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Collapses a body to a short preview line for inbox lists. */
export function buildSnippet(text: string | undefined, html: string | undefined): string {
  const source =
    text?.trim() ||
    (html ? html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ') : '');
  return source
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}
