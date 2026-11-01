/**
 * Local mail store.
 *
 * The mail API does not exist yet, so the app runs on sample data kept in this
 * store and persisted on device. Every screen talks to the store through the
 * actions below, which is the seam where API calls will go later.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { parseAddresses, stripPrefix } from './format';
import {
  SAMPLE_ACCOUNTS,
  SAMPLE_LABELS,
  SAMPLE_VERSION,
  buildSampleThreads,
  defaultSettings,
} from './sample-data';
import type {
  Account,
  AccountSettings,
  Address,
  Draft,
  FolderKey,
  Label,
  Location,
  Message,
  Settings,
  Thread,
} from './types';

export type MailState = {
  version: number;
  accounts: Account[];
  activeAccountId: string;
  labels: Label[];
  threads: Thread[];
  drafts: Draft[];
  settings: Settings;
  folder: FolderKey;
  recentSearches: string[];
};

const STORAGE_KEY = 'sendraa.mail';

function freshState(): MailState {
  return {
    version: SAMPLE_VERSION,
    accounts: SAMPLE_ACCOUNTS,
    activeAccountId: SAMPLE_ACCOUNTS[0]!.id,
    labels: SAMPLE_LABELS,
    threads: buildSampleThreads(),
    drafts: [],
    settings: defaultSettings(),
    folder: 'inbox',
    recentSearches: [],
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

type KV = { getItemSync(key: string): string | null; setItemSync(key: string, value: string): void };

function storage(): KV | null {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return null;
      return {
        getItemSync: (k) => localStorage.getItem(k),
        setItemSync: (k, v) => localStorage.setItem(k, v),
      };
    }
    // Loaded lazily so the web bundle never pulls in the native SQLite module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-sqlite/kv-store').Storage as KV;
  } catch {
    return null;
  }
}

function load(): MailState {
  try {
    const raw = storage()?.getItemSync(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as MailState;
    if (parsed.version !== SAMPLE_VERSION) return freshState();
    return { ...freshState(), ...parsed, settings: { ...defaultSettings(), ...parsed.settings } };
  } catch {
    return freshState();
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      storage()?.setItemSync(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Losing a write only loses local sample state; the next change retries.
    }
  }, 250);
}

// ---------------------------------------------------------------------------
// Store core
// ---------------------------------------------------------------------------

let state: MailState = load();
const listeners = new Set<() => void>();

function setState(next: MailState) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The whole store. The reference only changes when the store changes, so derive with useMemo. */
export function useMail(): MailState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function getMail(): MailState {
  return state;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export type UndoEntry = {
  key: number;
  text: string;
  /** How long the bar stays, in milliseconds. */
  duration: number;
  previous: Pick<MailState, 'threads' | 'drafts'>;
  /** Called after the previous state is restored, for example to reopen a draft. */
  afterUndo?: () => void;
};

let undoEntry: UndoEntry | null = null;
let undoKey = 0;
const undoListeners = new Set<() => void>();

function offerUndo(text: string, previous: MailState, options?: { duration?: number; afterUndo?: () => void }) {
  undoKey += 1;
  undoEntry = {
    key: undoKey,
    text,
    duration: options?.duration ?? 5000,
    previous: { threads: previous.threads, drafts: previous.drafts },
    afterUndo: options?.afterUndo,
  };
  undoListeners.forEach((l) => l());
}

export function useUndo(): UndoEntry | null {
  return useSyncExternalStore(
    (l) => {
      undoListeners.add(l);
      return () => undoListeners.delete(l);
    },
    () => undoEntry,
    () => undoEntry,
  );
}

export function undo() {
  if (!undoEntry) return;
  const entry = undoEntry;
  dismissUndo();
  setState({ ...state, threads: entry.previous.threads, drafts: entry.previous.drafts });
  entry.afterUndo?.();
}

export function dismissUndo(key?: number) {
  if (!undoEntry || (key !== undefined && undoEntry.key !== key)) return;
  undoEntry = null;
  undoListeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function updateThreads(ids: string[], fn: (t: Thread) => Thread): Thread[] {
  const set = new Set(ids);
  return state.threads.map((t) => (set.has(t.id) ? fn(t) : t));
}

function plural(n: number, one: string, many = `${one}s`) {
  return n === 1 ? one : many;
}

function conversationsText(n: number) {
  return n === 1 ? 'Conversation' : `${n} conversations`;
}

export function activeAccount(s: MailState = state): Account {
  return s.accounts.find((a) => a.id === s.activeAccountId) ?? s.accounts[0]!;
}

// ---------------------------------------------------------------------------
// Navigation state
// ---------------------------------------------------------------------------

export function setFolder(folder: FolderKey) {
  setState({ ...state, folder });
}

export function setActiveAccount(accountId: string) {
  setState({ ...state, activeAccountId: accountId, folder: 'inbox' });
}

// ---------------------------------------------------------------------------
// Conversation actions
// ---------------------------------------------------------------------------

export function markRead(ids: string[], read: boolean) {
  setState({ ...state, threads: updateThreads(ids, (t) => ({ ...t, unread: !read })) });
}

export function setStarred(ids: string[], starred: boolean) {
  setState({ ...state, threads: updateThreads(ids, (t) => ({ ...t, starred })) });
}

export function setImportant(ids: string[], important: boolean) {
  setState({ ...state, threads: updateThreads(ids, (t) => ({ ...t, important })) });
}

function relocate(ids: string[], location: Location, text: string) {
  const previous = state;
  setState({
    ...state,
    threads: updateThreads(ids, (t) => ({ ...t, location, snoozedUntil: location === 'inbox' ? null : t.snoozedUntil })),
  });
  offerUndo(text, previous);
}

export function archive(ids: string[]) {
  relocate(ids, 'archive', `${conversationsText(ids.length)} archived`);
}

export function moveToInbox(ids: string[]) {
  relocate(ids, 'inbox', `${conversationsText(ids.length)} moved to Inbox`);
}

export function trash(ids: string[]) {
  relocate(ids, 'trash', `${conversationsText(ids.length)} moved to Trash`);
}

export function reportSpam(ids: string[]) {
  relocate(ids, 'spam', `${conversationsText(ids.length)} reported as spam`);
}

export function moveTo(ids: string[], location: Location) {
  const names: Record<Location, string> = {
    inbox: 'Inbox',
    archive: 'Archive',
    sent: 'Sent',
    scheduled: 'Scheduled',
    spam: 'Spam',
    trash: 'Trash',
  };
  relocate(ids, location, `${conversationsText(ids.length)} moved to ${names[location]}`);
}

export function deleteForever(ids: string[]) {
  const previous = state;
  const set = new Set(ids);
  setState({ ...state, threads: state.threads.filter((t) => !set.has(t.id)) });
  offerUndo(`${conversationsText(ids.length)} deleted`, previous);
}

export function emptyFolder(location: 'trash' | 'spam') {
  const previous = state;
  const accountId = state.activeAccountId;
  setState({
    ...state,
    threads: state.threads.filter((t) => !(t.location === location && t.accountId === accountId)),
  });
  offerUndo(location === 'trash' ? 'Trash emptied' : 'Spam emptied', previous);
}

export function snooze(ids: string[], until: Date) {
  const previous = state;
  setState({
    ...state,
    threads: updateThreads(ids, (t) => ({
      ...t,
      snoozedUntil: until.toISOString(),
      location: t.location === 'archive' ? 'inbox' : t.location,
    })),
  });
  const when = until.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  offerUndo(`Snoozed until ${when}`, previous);
}

export function unsnooze(ids: string[]) {
  setState({ ...state, threads: updateThreads(ids, (t) => ({ ...t, snoozedUntil: null })) });
}

export function toggleLabel(ids: string[], labelId: string, on: boolean) {
  setState({
    ...state,
    threads: updateThreads(ids, (t) => ({
      ...t,
      labelIds: on ? Array.from(new Set([...t.labelIds, labelId])) : t.labelIds.filter((l) => l !== labelId),
    })),
  });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const LABEL_COLORS = ['#4D6B00', '#0F6E68', '#7A1E3A', '#A8470B', '#1E3A8A', '#4A3FD8'];

export function createLabel(name: string): Label | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (state.labels.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) return null;
  const label = { id: newId('label'), name: trimmed, color: LABEL_COLORS[state.labels.length % LABEL_COLORS.length]! };
  setState({ ...state, labels: [...state.labels, label] });
  return label;
}

export function renameLabel(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  setState({ ...state, labels: state.labels.map((l) => (l.id === id ? { ...l, name: trimmed } : l)) });
}

export function deleteLabel(id: string) {
  setState({
    ...state,
    labels: state.labels.filter((l) => l.id !== id),
    threads: state.threads.map((t) => ({ ...t, labelIds: t.labelIds.filter((l) => l !== id) })),
    folder: state.folder === `label:${id}` ? 'inbox' : state.folder,
  });
}

// ---------------------------------------------------------------------------
// Drafts and sending
// ---------------------------------------------------------------------------

export function emptyDraft(partial?: Partial<Draft>): Draft {
  return {
    id: newId('draft'),
    accountId: state.activeAccountId,
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    attachments: [],
    mode: 'new',
    threadId: null,
    updatedAt: nowIso(),
    ...partial,
  };
}

export function draftHasContent(d: Draft): boolean {
  return Boolean(d.to.trim() || d.cc.trim() || d.bcc.trim() || d.subject.trim() || d.body.trim() || d.attachments.length);
}

export function saveDraft(draft: Draft) {
  const next = { ...draft, updatedAt: nowIso() };
  const exists = state.drafts.some((d) => d.id === draft.id);
  setState({
    ...state,
    drafts: exists ? state.drafts.map((d) => (d.id === draft.id ? next : d)) : [next, ...state.drafts],
  });
}

export function deleteDraft(id: string) {
  setState({ ...state, drafts: state.drafts.filter((d) => d.id !== id) });
}

export function discardDraft(id: string) {
  const previous = state;
  setState({ ...state, drafts: state.drafts.filter((d) => d.id !== id) });
  offerUndo('Draft discarded', previous);
}

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a draft. In the sample store this files the message under Sent (or
 * Scheduled) immediately and offers an undo window the length of the
 * undo-send setting. Undo puts the draft back and reopens it.
 */
export function send(draft: Draft, options: { scheduledAt?: Date; reopen: (draftId: string) => void }): SendResult {
  const to = parseAddresses(draft.to);
  const cc = parseAddresses(draft.cc);
  const bcc = parseAddresses(draft.bcc);
  if (to.length + cc.length + bcc.length === 0) {
    return { ok: false, error: 'Add at least one recipient with a valid email address.' };
  }

  const account = state.accounts.find((a) => a.id === draft.accountId) ?? activeAccount();
  const from: Address = { name: account.name, address: account.address };
  const message: Message = {
    id: newId('m'),
    from,
    to,
    cc,
    date: (options.scheduledAt ?? new Date()).toISOString(),
    body: draft.body,
    attachments: draft.attachments,
  };

  const previous = { ...state, drafts: state.drafts.some((d) => d.id === draft.id) ? state.drafts : [draft, ...state.drafts] };
  const scheduled = Boolean(options.scheduledAt);
  const subject = draft.subject.trim() || '(no subject)';

  let threads: Thread[];
  const replyTarget = draft.threadId && (draft.mode === 'reply' || draft.mode === 'replyAll')
    ? state.threads.find((t) => t.id === draft.threadId)
    : undefined;

  if (replyTarget && !scheduled) {
    threads = state.threads.map((t) => (t.id === replyTarget.id ? { ...t, messages: [...t.messages, message] } : t));
  } else {
    const created: Thread = {
      id: newId('t'),
      accountId: account.id,
      subject: replyTarget ? replyTarget.subject : subject,
      messages: [message],
      location: scheduled ? 'scheduled' : 'sent',
      labelIds: [],
      starred: false,
      unread: false,
      important: false,
      snoozedUntil: null,
      scheduledAt: options.scheduledAt?.toISOString() ?? null,
    };
    threads = [created, ...state.threads];
  }

  setState({ ...state, threads, drafts: state.drafts.filter((d) => d.id !== draft.id) });

  const when = options.scheduledAt?.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  offerUndo(scheduled ? `Scheduled for ${when}` : 'Message sent', previous, {
    duration: state.settings.undoSendSeconds * 1000,
    afterUndo: () => options.reopen(draft.id),
  });
  return { ok: true };
}

export function cancelScheduled(threadId: string, reopen: (draftId: string) => void) {
  const t = state.threads.find((x) => x.id === threadId);
  const m = t?.messages[0];
  if (!t || !m) return;
  const draft = emptyDraft({
    accountId: t.accountId,
    to: m.to.map((a) => a.address).join(', '),
    cc: m.cc.map((a) => a.address).join(', '),
    subject: t.subject,
    body: m.body,
    attachments: m.attachments,
  });
  setState({ ...state, threads: state.threads.filter((x) => x.id !== threadId), drafts: [draft, ...state.drafts] });
  reopen(draft.id);
}

/** Builds the draft for a reply, reply-all or forward, with the quoted original and signature. */
export function draftFor(threadId: string, mode: 'reply' | 'replyAll' | 'forward'): Draft {
  const t = state.threads.find((x) => x.id === threadId);
  const last = t?.messages[t.messages.length - 1];
  if (!t || !last) return emptyDraft();

  const account = state.accounts.find((a) => a.id === t.accountId) ?? activeAccount();
  const mine = account.address.toLowerCase();
  const fromMe = last.from.address.toLowerCase() === mine;
  const base = stripPrefix(t.subject);

  let to = '';
  let cc = '';
  if (mode === 'reply') {
    to = (fromMe ? last.to[0]?.address : last.from.address) ?? '';
  } else if (mode === 'replyAll') {
    const others = [last.from, ...last.to, ...last.cc]
      .map((a) => a.address)
      .filter((a, i, arr) => a.toLowerCase() !== mine && arr.indexOf(a) === i);
    to = others[0] ?? '';
    cc = others.slice(1).join(', ');
  }

  const header =
    mode === 'forward'
      ? `---------- Forwarded message ----------\nFrom: ${last.from.name} <${last.from.address}>\nDate: ${new Date(last.date).toLocaleString()}\nSubject: ${t.subject}\n\n`
      : `On ${new Date(last.date).toLocaleString()}, ${last.from.name || last.from.address} wrote:\n`;
  const quoted = mode === 'forward' ? last.body : last.body.split('\n').map((l) => `> ${l}`).join('\n');

  return emptyDraft({
    accountId: account.id,
    to,
    cc,
    subject: `${mode === 'forward' ? 'Fwd' : 'Re'}: ${base}`,
    body: `${signatureBlock(account.id)}\n\n${header}${quoted}`,
    attachments: mode === 'forward' ? last.attachments : [],
    mode,
    threadId,
  });
}

/** The signature as it is inserted into a new message, with a blank line to type above it. */
export function signatureBlock(accountId: string): string {
  const s = state.settings.accounts[accountId];
  if (!s?.signatureEnabled || !s.signature.trim()) return '';
  return `\n\n--\n${s.signature.trim()}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function updateSettings(patch: Partial<Settings>) {
  setState({ ...state, settings: { ...state.settings, ...patch } });
}

export function updateAccountSettings(accountId: string, patch: Partial<AccountSettings>) {
  const current = state.settings.accounts[accountId] ?? defaultSettings().accounts['acc-samie']!;
  setState({
    ...state,
    settings: { ...state.settings, accounts: { ...state.settings.accounts, [accountId]: { ...current, ...patch } } },
  });
}

export function addRecentSearch(query: string) {
  const q = query.trim();
  if (!q) return;
  setState({ ...state, recentSearches: [q, ...state.recentSearches.filter((s) => s !== q)].slice(0, 8) });
}

export function clearRecentSearches() {
  setState({ ...state, recentSearches: [] });
}

export function resetSampleData() {
  dismissUndo();
  setState(freshState());
}

export { plural };
