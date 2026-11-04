/** Conservative numeric OTP detection. Ambiguous messages require opening the mail. */
export function extractOtp(subject: string, text: string | null, html: string | null): string | null {
  const plain = text || (html ?? '').replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ');
  const content = `${subject}\n${plain}`.slice(0, 32_000);
  const context = /\b(?:otp|one[ -]?time (?:password|code)|(?:verification|security|authentication|confirmation|login|sign[ -]?in|access) code|code (?:is|for))\b/gi;
  const codes = new Set<string>();
  for (const match of content.matchAll(context)) {
    const nearby = content.slice(Math.max(0, match.index - 36), match.index + match[0].length + 100);
    for (const number of nearby.matchAll(/(?<![\w+.-])\d{4,8}(?![\w-]|\.\d)/g)) codes.add(number[0]);
  }
  return codes.size === 1 ? [...codes][0]! : null;
}
