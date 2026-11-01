/**
 * Real mail from the workspace's Cloudflare account, through the Sendraa API.
 *
 * The screens keep reading the local store. This module fills it with the
 * mailboxes and conversations from the server, loads a full conversation when
 * it is opened, and writes changes (read, star, move, snooze, labels) back.
 */
import { api } from '@/lib/api';
import { API_URL, authClient } from '@/lib/auth-client';

import { applyFromServer, getMail, setRemoteSink } from './store';
import type { Account, Address, Attachment, Location, Message, Thread } from './types';

type ServerMailbox = { id: string; address: string; display_name: string; shared: boolean };

type ServerThread = {
  id: string;
  mailboxId: string;
  subject: string;
  snippet: string;
  participants: Address[];
  location: Location;
  labelIds: string[];
  starred: boolean;
  unread: boolean;
  important: boolean;
  snoozedUntil: string | null;
  messageCount: number;
  hasAttachments: boolean;
  lastMessageAt: string;
};

type ServerMessage = {
  id: string;
  from: Address;
  to: Address[];
  cc: Address[];
  date: string;
  text: string | null;
  html: string | null;
  needsParse: boolean;
  attachments: { id: string; name: string; type: string; size: number; inline: boolean }[];
};

let tenantId: string | null = null;

const base = (mailboxId: string) => `/v1/tenants/${tenantId}/mailboxes/${mailboxId}`;

/** Plain-text view of an HTML body. Rendering rich HTML belongs to a later phase. */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A list summary as a thread with one stand-in message, so list rows render before the thread is opened. */
function summaryToThread(t: ServerThread, existing?: Thread): Thread {
  const sender = t.participants[t.participants.length - 1] ?? { name: '', address: '' };
  const keepMessages = existing?.remote?.loaded && existing.messages.length === t.messageCount;
  return {
    id: t.id,
    accountId: t.mailboxId,
    subject: t.subject || '(no subject)',
    messages: keepMessages
      ? existing.messages
      : [
          {
            id: `${t.id}:summary`,
            from: sender,
            to: [],
            cc: [],
            date: t.lastMessageAt,
            body: t.snippet,
            attachments: t.hasAttachments ? [{ id: `${t.id}:att`, name: 'Attachment', size: 0, type: '' }] : [],
          },
        ],
    location: t.location,
    labelIds: t.labelIds,
    starred: t.starred,
    unread: t.unread,
    important: t.important,
    snoozedUntil: t.snoozedUntil,
    scheduledAt: null,
    remote: { tenantId: tenantId!, loaded: Boolean(keepMessages) },
  };
}

function toMessage(m: ServerMessage): Message {
  const attachments: Attachment[] = m.attachments.filter((a) => !a.inline).map((a) => ({ id: a.id, name: a.name || 'Attachment', size: a.size, type: a.type }));
  const body = m.text ?? (m.html ? htmlToText(m.html) : m.needsParse ? 'This message is large and is still being processed.' : '');
  return { id: m.id, from: m.from, to: m.to, cc: m.cc, date: m.date ?? new Date().toISOString(), body, attachments };
}

/**
 * Points the store at a workspace's real mailboxes. Sample accounts and their
 * mail are replaced; the active mailbox is kept if it still exists.
 */
export async function connectWorkspace(id: string): Promise<Account[]> {
  tenantId = id;
  setRemoteSink(pushChanges);
  const { mailboxes } = await api<{ mailboxes: ServerMailbox[] }>(`/v1/tenants/${id}/mailboxes`);
  const accounts: Account[] = mailboxes.map((m) => ({ id: m.id, address: m.address, name: m.display_name || m.address, shared: m.shared, live: true }));
  if (accounts.length === 0) return accounts;
  applyFromServer((s) => {
    const ids = new Set(accounts.map((a) => a.id));
    return {
      ...s,
      accounts,
      activeAccountId: ids.has(s.activeAccountId) ? s.activeAccountId : accounts[0]!.id,
      // Keep cached server mail for these mailboxes; drop sample mail.
      threads: s.threads.filter((t) => t.remote && ids.has(t.accountId)),
      drafts: s.drafts.filter((d) => ids.has(d.accountId)),
      settings: {
        ...s.settings,
        accounts: Object.fromEntries(accounts.map((a) => [a.id, s.settings.accounts[a.id] ?? { signature: '', signatureEnabled: false, vacation: { enabled: false, subject: '', message: '', contactsOnly: false } }])),
      },
    };
  });
  return accounts;
}

const LOCATIONS: Location[] = ['inbox', 'archive', 'sent', 'spam', 'trash'];

/** Fetches every folder of one mailbox and replaces its conversations in the store. */
export async function refreshMailbox(mailboxId: string): Promise<void> {
  if (!tenantId) return;
  const lists = await Promise.all([
    ...LOCATIONS.map((l) => api<{ threads: ServerThread[] }>(`${base(mailboxId)}/threads?location=${l}&limit=100`)),
    api<{ threads: ServerThread[] }>(`${base(mailboxId)}/threads?view=snoozed&limit=100`),
  ]);
  const byId = new Map<string, ServerThread>();
  for (const l of lists) for (const t of l.threads) byId.set(t.id, t);
  applyFromServer((s) => {
    const current = new Map(s.threads.map((t) => [t.id, t]));
    const fresh = [...byId.values()].map((t) => summaryToThread(t, current.get(t.id)));
    return { ...s, threads: [...s.threads.filter((t) => t.accountId !== mailboxId), ...fresh] };
  });
}

/** Loads the full conversation the first time it is opened. */
export async function loadThread(threadId: string): Promise<void> {
  const t = getMail().threads.find((x) => x.id === threadId);
  if (!t?.remote || t.remote.loaded) return;
  const full = await api<ServerThread & { messages: ServerMessage[] }>(`${base(t.accountId)}/threads/${threadId}`);
  applyFromServer((s) => ({
    ...s,
    threads: s.threads.map((x) =>
      x.id === threadId ? { ...summaryToThread(full, x), messages: full.messages.map(toMessage), remote: { tenantId: tenantId!, loaded: true } } : x,
    ),
  }));
}

/** Writes local changes back. On failure the next refresh restores the server's view. */
function pushChanges(threads: Thread[]) {
  for (const t of threads) {
    void api(`${base(t.accountId)}/threads/${t.id}`, {
      method: 'PATCH',
      body: { location: t.location, starred: t.starred, unread: t.unread, important: t.important, labelIds: t.labelIds, snoozedUntil: t.snoozedUntil },
    }).catch(() => refreshMailbox(t.accountId).catch(() => undefined));
  }
}

/** Download URL and headers for an attachment of a server conversation. */
export async function attachmentRequest(mailboxId: string, attachmentId: string) {
  return { uri: `${API_URL}${base(mailboxId)}/attachments/${attachmentId}`, headers: { cookie: await authClient.getCookie() } };
}

export const isLive = () => tenantId !== null;
