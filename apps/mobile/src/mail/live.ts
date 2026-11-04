/**
 * Real mail from the workspace's Cloudflare account, through the Sendraa API.
 *
 * The screens keep reading the local store. This module fills it with the
 * mailboxes and conversations from the server, loads a full conversation when
 * it is opened, and writes changes (read, star, move, snooze, labels) back.
 */
import { api, sessionInit } from '@/lib/api';
import { API_URL } from '@/lib/auth-client';

import { applyFromServer, getMail, setRemoteSink } from './store';
import type { Account, Address, Attachment, Draft, Location, Message, Thread } from './types';
import { localAttachmentBase64 } from './attachment-content';
import { parseAddresses } from './format';
import { htmlToText } from './message-links';

type ServerMailbox = { id: string; address: string; display_name: string; shared: boolean; canSend: boolean };

type ServerThread = {
  hasSent?: boolean;
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
  parseError?: string;
  attachments: { id: string; name: string; type: string; size: number; inline: boolean }[];
};

let tenantId: string | null = null;
let generation = 0;
export function disconnectMail() { generation++; tenantId=null; setRemoteSink(null); }

const base = (mailboxId: string) => `/v1/tenants/${tenantId}/mailboxes/${mailboxId}`;

/** A list summary as a thread with one stand-in message, so list rows render before the thread is opened. */
function summaryToThread(t: ServerThread, existing?: Thread): Thread {
  const sender = t.participants[t.participants.length - 1] ?? { name: '', address: '' };
  const keepMessages = existing?.remote?.loaded && existing.messages.length === t.messageCount;
  return {
    id: t.id,
    hasSent: t.hasSent,
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
  const attachments: Attachment[] = m.attachments.map((a) => ({ id: a.id, name: a.name || 'Attachment', size: a.size, type: a.type }));
  const body = m.text ?? (m.html ? htmlToText(m.html) : m.needsParse ? 'This message needs processing before its contents can be displayed.' : '');
  return { id: m.id, from: m.from, to: m.to, cc: m.cc, date: m.date ?? new Date().toISOString(), body, attachments, needsParse: m.needsParse, parseError: m.parseError };
}

/**
 * Points the store at a workspace's real mailboxes. Sample accounts and their
 * mail are replaced; the active mailbox is kept if it still exists.
 */
export async function connectWorkspace(id: string): Promise<Account[]> {
  if(tenantId !== id)generation++;
  const request = generation;
  tenantId = id;
  setRemoteSink(pushChanges);
  const { mailboxes } = await api<{ mailboxes: ServerMailbox[] }>(`/v1/tenants/${id}/mailboxes`);
  if(request !== generation)return [];
  const accounts: Account[] = mailboxes.map((m) => ({ id: m.id, address: m.address, name: m.display_name || m.address, shared: m.shared, live: true, canSend: m.canSend }));
  // Keep screens usable for mailbox managers without exposing cached/sample mail.
  if (!accounts.length) accounts.push({id:'unassigned',address:'No mailbox assigned',name:'No mailbox access',shared:false,live:true,canSend:false,unavailable:true});
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
  const request = generation;
  const lists = await Promise.all([
    ...LOCATIONS.map((l) => api<{ threads: ServerThread[] }>(`${base(mailboxId)}/threads?location=${l}&limit=100`)),
    api<{ threads: ServerThread[] }>(`${base(mailboxId)}/threads?view=snoozed&limit=100`),
  ]);
  if(request !== generation)return;
  const byId = new Map<string, ServerThread>();
  for (const l of lists) for (const t of l.threads) byId.set(t.id, t);
  applyFromServer((s) => {
    const current = new Map(s.threads.map((t) => [t.id, t]));
    const fresh = [...byId.values()].map((t) => summaryToThread(t, current.get(t.id)));
    return { ...s, threads: [...s.threads.filter((t) => t.accountId !== mailboxId), ...fresh] };
  });
}

/** Loads the full conversation the first time it is opened. */
export async function loadThread(threadId: string, force = false): Promise<void> {
  const t = getMail().threads.find((x) => x.id === threadId);
  if (!t?.remote || (t.remote.loaded && !force)) return;
  const workspaceId = t.remote.tenantId;
  const request = generation;
  const full = await api<ServerThread & { messages: ServerMessage[] }>(`/v1/tenants/${workspaceId}/mailboxes/${t.accountId}/threads/${threadId}`);
  if (tenantId !== workspaceId || request !== generation) return;
  applyFromServer((s) => ({
    ...s,
    threads: s.threads.map((x) =>
      x.id === threadId ? { ...summaryToThread(full, x), messages: full.messages.map((m) => ({ ...toMessage(m), attachments: toMessage(m).attachments.map((a) => ({ ...a, sourceMailboxId: t.accountId })) })), remote: { tenantId: tenantId!, loaded: true } } : x,
    ),
  }));
}

/** A push can point to a thread outside the currently loaded page. */
export async function loadNotificationThread(workspaceId:string,mailboxId:string,threadId:string) {
  const request=generation;
  const full=await api<ServerThread & {messages:ServerMessage[]}>(`/v1/tenants/${workspaceId}/mailboxes/${mailboxId}/threads/${threadId}`);
  if(tenantId!==workspaceId || request!==generation)return;
  applyFromServer((s)=>({...s,threads:[...s.threads.filter((t)=>t.id!==threadId),{
    ...summaryToThread(full),messages:full.messages.map(toMessage),remote:{tenantId:workspaceId,loaded:true},
  }]}));
}

/** Writes local changes back. On failure the next refresh restores the server's view. */
function pushChanges(threads: Thread[]) {
  const request=generation;
  for (const t of threads) {
    void api(`${base(t.accountId)}/threads/${t.id}`, {
      method: 'PATCH',
      body: { location: t.location, starred: t.starred, unread: t.unread, important: t.important, labelIds: t.labelIds, snoozedUntil: t.snoozedUntil },
    }).catch(() => request===generation ? refreshMailbox(t.accountId).catch(() => undefined) : undefined);
  }
}

/**
 * Download URL and headers for an attachment of a server conversation. On web the headers are
 * empty: the browser sends the session cookie itself (load it with credentials included).
 */
export async function attachmentRequest(mailboxId: string, attachmentId: string) {
  const { headers } = await sessionInit();
  return { uri: `${API_URL}${base(mailboxId)}/attachments/${attachmentId}`, headers };
}

export const isLive = () => tenantId !== null;

export async function sendLiveDraft(draft: Draft) {
  if (!tenantId) throw new Error('Open your workspace before sending.');
  const request=generation;
  const mailbox = getMail().accounts.find((a) => a.id === draft.accountId);
  if (!mailbox?.live || !mailbox.canSend) throw new Error('You do not have permission to send from this mailbox.');
  const recipients = (value: string) => {
    const list = parseAddresses(value);
    if (list.length !== value.split(/[,;]/).filter((v) => v.trim()).length) throw new Error('One of the recipient addresses is invalid. Check To, Cc and Bcc.');
    return list;
  };
  const to = recipients(draft.to), cc = recipients(draft.cc), bcc = recipients(draft.bcc);
  if (to.length + cc.length + bcc.length === 0) throw new Error('Add at least one recipient.');
  const attachments = [];
  for (const a of draft.attachments) {
    let content: string;
    if (a.uri) content = await localAttachmentBase64(a.uri);
    else {
      const request = await attachmentRequest(a.sourceMailboxId ?? draft.accountId,a.id);
      const response = await fetch(request.uri,{ headers:request.headers,credentials:(await sessionInit()).credentials });
      if (!response.ok) throw new Error(`Could not load ${a.name}. Remove it and attach it again.`);
      const blob = await response.blob();
      content = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(new Error(`Could not read ${a.name}.`)); reader.readAsDataURL(blob); });
    }
    attachments.push({ name:a.name,type:a.type || 'application/octet-stream',content });
    if (attachments.reduce((n,a)=>n+a.content.length,0)>25*1024*1024) throw new Error('Attachments exceed the encoded message size limit. Remove some files.');
  }
  if(request!==generation)throw new Error('Account changed. Open this draft in its original account to send.');
  return api<{ id:string; accepted:string[]; rejected:string[]; saved:boolean }>(`${base(draft.accountId)}/send`, { method:'POST',body:{requestKey:draft.sendKey??draft.id,to,cc,bcc,subject:draft.subject,text:draft.body,threadId:draft.mode==='reply'||draft.mode==='replyAll'?draft.threadId:null,attachments} });
}
