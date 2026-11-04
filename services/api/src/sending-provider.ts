import nodemailer from 'nodemailer';
import { CloudflareApiError, type CloudflareApi } from '@sendraa/cloudflare';
import { z } from 'zod';

export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const singleLine = z.string().refine((v) => !/[\r\n\0]/.test(v), 'Line breaks are not allowed here.');
export const addressInput = z.object({ address: z.email().max(254), name: singleLine.max(80).default('') }).strict();
export const sendInput = z.object({
  requestKey: z.string().min(1).max(128).regex(/^[\w.-]+$/),
  to: z.array(addressInput).max(50), cc: z.array(addressInput).max(50).default([]), bcc: z.array(addressInput).max(50).default([]),
  subject: singleLine.max(998), text: z.string().max(1_000_000),
  threadId: z.string().regex(/^[\w-]{1,64}$/).nullable().default(null),
  attachments: z.array(z.object({
    name: singleLine.min(1).max(255), type: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
    content: z.string().max(34_952_536).refine((v) => v.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v), 'Attachment content must be base64.'),
  }).strict()).max(20).default([]),
}).strict().refine((v) => v.to.length + v.cc.length + v.bcc.length > 0 && v.to.length + v.cc.length + v.bcc.length <= 50, 'Add between 1 and 50 recipients.');
export type SendInput = z.infer<typeof sendInput>;
export type Outbound = SendInput & { html?: string; from: z.infer<typeof addressInput>; messageId: string; date: string; inReplyTo: string | null; references: string[] };
export type DeliveryResult = { accepted: string[]; rejected: string[]; messageId: string | null };

export class DeliveryError extends Error {
  constructor(readonly uncertain: boolean, readonly code: string, message: string) { super(message); }
}

export function gmailTransport(user: string, pass: string) {
  return nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true,
    auth: { user, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 45_000,
    disableFileAccess: true, disableUrlAccess: true });
}

export function mailOptions(mail: Outbound) {
  return { from: mail.from, replyTo: mail.from, to: mail.to, cc: mail.cc, bcc: mail.bcc, subject: mail.subject, text: mail.text || ' ', ...(mail.html ? { html: mail.html } : {}),
    messageId: mail.messageId, date: new Date(mail.date), inReplyTo: mail.inReplyTo ?? undefined, references: mail.references,
    attachments: mail.attachments.map((a) => ({ filename: a.name, contentType: a.type, content: Buffer.from(a.content, 'base64') })),
    disableFileAccess: true, disableUrlAccess: true };
}

export async function rawMessage(mail: Outbound): Promise<Buffer> {
  const result = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' }).sendMail(mailOptions(mail));
  if (!Buffer.isBuffer(result.message)) throw new Error('Expected a buffered MIME message.');
  return result.message;
}

export async function sendGmail(mail: Outbound, user: string, password: string): Promise<DeliveryResult> {
  const transport = gmailTransport(user, password);
  try {
    const result = await transport.sendMail(mailOptions(mail));
    return { accepted: result.accepted.map(String), rejected: result.rejected.map(String), messageId: result.messageId };
  } catch (err) {
    const e = err as { code?: string; responseCode?: number };
    const certain = e.code === 'EAUTH' || e.code === 'EENVELOPE' || (e.responseCode !== undefined && e.responseCode >= 400);
    throw new DeliveryError(!certain, certain ? 'SEND_REJECTED' : 'SEND_UNKNOWN', certain
      ? 'Gmail rejected the message. Check the app password, verified Send mail as alias, and sending quota.'
      : 'Gmail did not confirm the outcome. Check Sent in Gmail before sending another copy.');
  } finally { transport.close(); }
}

const cfResult = z.object({ delivered: z.array(z.string()), queued: z.array(z.string()), permanent_bounces: z.array(z.string()),
  suppressed_recipients: z.array(z.string()).default([]), message_id: z.string() });

export async function sendCloudflare(mail: Outbound, cf: CloudflareApi, accountId: string): Promise<DeliveryResult> {
  try {
    // Cloudflare owns Message-ID; setting it as a custom header is rejected.
    const result = cfResult.parse(await cf.post(`/accounts/${accountId}/email/sending/send`, {
      from: mail.from, to: mail.to, ...(mail.cc.length ? { cc: mail.cc } : {}), ...(mail.bcc.length ? { bcc: mail.bcc } : {}),
      subject: mail.subject, text: mail.text || ' ', ...(mail.html ? { html: mail.html } : {}),
      headers: { ...(mail.inReplyTo ? { 'In-Reply-To': mail.inReplyTo } : {}), ...(mail.references.length ? { References: mail.references.join(' ') } : {}) },
      attachments: mail.attachments.map((a) => ({ filename: a.name, type: a.type, content: a.content, disposition: 'attachment' })),
    }));
    return { accepted: [...result.delivered, ...result.queued], rejected: [...result.permanent_bounces, ...result.suppressed_recipients], messageId: result.message_id ?? null };
  } catch (err) {
    if (err instanceof CloudflareApiError && err.status >= 400 && err.status < 500) {
      const message = err.notEntitled ? 'This Cloudflare account is not entitled to Email Sending. Enable it or use Gmail.'
        : err.needsReauth || err.status === 403 ? 'Cloudflare refused sending access. Check Email Sending permissions and domain activation.'
        : err.status === 429 ? 'Cloudflare’s sending limit was reached. Try again later.' : 'Cloudflare rejected this message. Check sender verification, recipients and message size.';
      throw new DeliveryError(false, 'SEND_REJECTED', message);
    }
    throw new DeliveryError(true, 'SEND_UNKNOWN', 'Cloudflare did not confirm the outcome. Check its Email Sending activity before sending another copy.');
  }
}
