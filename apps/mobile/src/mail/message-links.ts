export type MessagePart = { kind: 'text' | 'link'; value: string };

/** Keep signed URLs byte-for-byte intact; only HTTP(S) is opened from email. */
export function webLink(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let start = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let url = match[0].replace(/[.,!?;:]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']']]) {
      while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
    }
    if (!webLink(url)) continue;
    if (match.index > start) parts.push({ kind: 'text', value: text.slice(start, match.index) });
    parts.push({ kind: 'link', value: url });
    start = match.index + url.length;
  }
  if (start < text.length) parts.push({ kind: 'text', value: text.slice(start) });
  return parts;
}

function entities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
    }
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[code.toLowerCase()] ?? whole;
  });
}

/** Text-only rendering: preserve anchor destinations without executing HTML or loading images. */
export function htmlToText(html: string): string {
  const links: string[] = [];
  const text = html.replace(/\u0000/g, '').replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_whole, attrs: string, label: string) => {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const url = entities(href?.[1] ?? href?.[2] ?? href?.[3] ?? '');
      if (!webLink(url)) return label;
      // Append after stripping markup so literal angle brackets/entities cannot corrupt the URL.
      links.push(url);
      return `${label}\n\u0000LINK${links.length - 1}\u0000\n`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return entities(text).replace(/\u0000LINK(\d+)\u0000/g, (_whole, n: string) => links[Number(n)] ?? '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
