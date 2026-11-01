import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { sql } from '../db/index.js';
import { buildSnippet, normaliseSubject } from '../lib/addresses.js';
import { logger } from '../lib/logger.js';
import { putRaw } from './raw-store.js';
import { resolveThread } from './threading.js';
import type { ResolvedRecipient } from './routing.js';

export interface IngestContext {
  recipient: ResolvedRecipient;
  envelopeFrom: string;
  clientIp: string | undefined;
  raw: Buffer;
}

interface Addr {
  address: string;
  name: string | null;
}

export interface IngestResult {
  messageId: string | null;
  duplicate: boolean;
}

/**
 * Parses and persists one inbound message for one mailbox.
 *
 * Called once per envelope recipient, so a message addressed to three of a
 * tenant's mailboxes is stored three times by design — each mailbox owns its
 * own copy, flags, and folder placement.
 */
export async function storeInbound(ctx: IngestContext): Promise<IngestResult> {
  const parsed = await simpleParser(ctx.raw, {
    skipImageLinks: true,
    skipTextToHtml: false,
  });

  const from = firstAddress(parsed.from);
  const to = addressList(parsed.to);
  const cc = addressList(parsed.cc);
  const subject = parsed.subject ?? null;
  const subjectNorm = normaliseSubject(subject);
  const receivedAt = parsed.date ?? new Date();

  const rfcMessageId = normaliseMessageId(parsed.messageId);
  const inReplyTo = normaliseMessageId(parsed.inReplyTo);
  const references = toReferenceArray(parsed.references);

  const auth = parseAuthResults(parsed.headers.get('authentication-results'));

  const rawKey = await putRaw(ctx.recipient.mailboxId, ctx.raw);

  const participants = [
    from?.address,
    ...to.map((a) => a.address),
    ...cc.map((a) => a.address),
  ].filter((v): v is string => Boolean(v));

  return sql.begin(async (tx) => {
    const threadId = await resolveThread(tx, {
      mailboxId: ctx.recipient.mailboxId,
      inReplyTo,
      references,
      subjectNorm,
      participants,
      at: receivedAt,
    });

    const inserted = await tx<{ id: string }[]>`
      insert into messages (
        mailbox_id, thread_id, direction,
        rfc_message_id, in_reply_to, refs,
        from_addr, from_name, to_addrs, cc_addrs, reply_to,
        subject, snippet, text_body, html_body,
        envelope_from, envelope_to, client_ip,
        spf_result, dkim_result, dmarc_result,
        size_bytes, has_attachments, raw_storage_key, received_at
      ) values (
        ${ctx.recipient.mailboxId}, ${threadId}, 'inbound',
        ${rfcMessageId}, ${inReplyTo}, ${references},
        ${from?.address ?? 'unknown@invalid'}, ${from?.name ?? null},
        ${JSON.stringify(to)}, ${JSON.stringify(cc)},
        ${firstAddress(parsed.replyTo)?.address ?? null},
        ${subject}, ${buildSnippet(parsed.text, parsed.html || undefined)},
        ${parsed.text ?? null}, ${parsed.html || null},
        ${ctx.envelopeFrom}, ${ctx.recipient.address}, ${ctx.clientIp ?? null},
        ${auth.spf}, ${auth.dkim}, ${auth.dmarc},
        ${ctx.raw.byteLength}, ${parsed.attachments.length > 0}, ${rawKey}, ${receivedAt}
      )
      on conflict (mailbox_id, rfc_message_id)
        where rfc_message_id is not null
        do nothing
      returning id
    `;

    const messageId = inserted[0]?.id;

    // A conflict means a retry or a duplicate fan-out of a message we already
    // hold. Roll back the thread bump so counts stay accurate.
    if (!messageId) {
      logger.debug({ rfcMessageId }, 'duplicate message ignored');
      throw new DuplicateMessage();
    }

    for (const att of parsed.attachments) {
      const key = await putRaw(
        `${ctx.recipient.mailboxId}/attachments`,
        Buffer.from(att.content),
      );
      await tx`
        insert into attachments (
          message_id, filename, content_type, size_bytes, storage_key, content_id, is_inline
        ) values (
          ${messageId}, ${att.filename ?? null}, ${att.contentType ?? null},
          ${att.size ?? null}, ${key}, ${att.cid ?? null},
          ${att.contentDisposition === 'inline'}
        )
      `;
    }

    const inboxId = await ensureSystemFolder(tx, ctx.recipient.mailboxId, 'inbox');
    await tx`
      insert into message_folders (message_id, folder_id)
      values (${messageId}, ${inboxId})
      on conflict do nothing
    `;

    if (from?.address) {
      await tx`
        insert into contacts (tenant_id, email, name, last_seen_at, message_count)
        values (${ctx.recipient.tenantId}, ${from.address}, ${from.name}, ${receivedAt}, 1)
        on conflict (tenant_id, email) do update
          set last_seen_at = greatest(contacts.last_seen_at, excluded.last_seen_at),
              message_count = contacts.message_count + 1,
              name = coalesce(contacts.name, excluded.name)
      `;
    }

    return { messageId, duplicate: false };
  }).catch((err: unknown) => {
    if (err instanceof DuplicateMessage) {
      return { messageId: null, duplicate: true };
    }
    throw err;
  });
}

class DuplicateMessage extends Error {
  constructor() {
    super('duplicate message');
    this.name = 'DuplicateMessage';
  }
}

async function ensureSystemFolder(
  tx: Parameters<Parameters<typeof sql.begin>[0]>[0],
  mailboxId: string,
  type: 'inbox' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash',
): Promise<string> {
  const name = type.charAt(0).toUpperCase() + type.slice(1);
  const rows = await tx<{ id: string }[]>`
    insert into folders (mailbox_id, name, type)
    values (${mailboxId}, ${name}, ${type})
    on conflict (mailbox_id, name) do update set name = excluded.name
    returning id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error(`failed to ensure ${type} folder`);
  return id;
}

function firstAddress(field: ParsedMail['from'] | ParsedMail['to']): Addr | null {
  const obj = Array.isArray(field) ? field[0] : field;
  const value = obj?.value?.[0];
  if (!value?.address) return null;
  return { address: value.address.toLowerCase(), name: value.name || null };
}

function addressList(field: ParsedMail['to']): Addr[] {
  if (!field) return [];
  const objs: AddressObject[] = Array.isArray(field) ? field : [field];
  return objs
    .flatMap((o) => o.value ?? [])
    .filter((v) => Boolean(v.address))
    .map((v) => ({ address: v.address!.toLowerCase(), name: v.name || null }));
}

/** Message-IDs are compared verbatim, so strip the angle brackets consistently. */
function normaliseMessageId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^<|>$/g, '');
  return trimmed.length > 0 ? trimmed : null;
}

function toReferenceArray(refs: ParsedMail['references']): string[] {
  if (!refs) return [];
  const list = Array.isArray(refs) ? refs : [refs];
  return list
    .flatMap((r) => r.split(/\s+/))
    .map((r) => r.trim().replace(/^<|>$/g, ''))
    .filter((r) => r.length > 0);
}

/**
 * Pulls SPF/DKIM/DMARC verdicts out of the Authentication-Results header.
 *
 * We are the first hop that the sender cannot forge, but today we only record
 * what an upstream relay asserted. Once we verify in-process these become
 * trustworthy enough to drive spam decisions.
 */
function parseAuthResults(header: unknown): {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
} {
  const raw = typeof header === 'string' ? header : null;
  if (!raw) return { spf: null, dkim: null, dmarc: null };

  const pick = (key: string) => {
    const m = raw.match(new RegExp(`${key}=(\\w+)`, 'i'));
    return m?.[1]?.toLowerCase() ?? null;
  };

  return { spf: pick('spf'), dkim: pick('dkim'), dmarc: pick('dmarc') };
}
