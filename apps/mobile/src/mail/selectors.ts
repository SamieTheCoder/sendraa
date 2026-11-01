import type { SFSymbol } from '@/theme/symbols';

import type { MailState } from './store';
import type { Address, FolderId, FolderKey, SwipeAction, Thread } from './types';

export type FolderMeta = { id: FolderId; title: string; ios: SFSymbol; android: string };

export const FOLDERS: FolderMeta[] = [
  { id: 'inbox', title: 'Inbox', ios: 'tray', android: 'inbox' },
  { id: 'starred', title: 'Starred', ios: 'star', android: 'star' },
  { id: 'snoozed', title: 'Snoozed', ios: 'clock', android: 'schedule' },
  { id: 'important', title: 'Important', ios: 'flag', android: 'label_important' },
  { id: 'sent', title: 'Sent', ios: 'paperplane', android: 'send' },
  { id: 'scheduled', title: 'Scheduled', ios: 'calendar.badge.clock', android: 'schedule_send' },
  { id: 'drafts', title: 'Drafts', ios: 'doc', android: 'draft' },
  { id: 'all', title: 'All Mail', ios: 'archivebox', android: 'mail' },
  { id: 'spam', title: 'Spam', ios: 'exclamationmark.octagon', android: 'report' },
  { id: 'trash', title: 'Trash', ios: 'trash', android: 'delete' },
];

export function folderTitle(state: MailState, key: FolderKey): string {
  if (key.startsWith('label:')) return state.labels.find((l) => `label:${l.id}` === key)?.name ?? 'Label';
  return FOLDERS.find((f) => f.id === key)?.title ?? 'Inbox';
}

const lastDate = (t: Thread) => t.messages[t.messages.length - 1]?.date ?? '';
const byRecent = (a: Thread, b: Thread) => lastDate(b).localeCompare(lastDate(a));

function isSnoozed(t: Thread, now: number) {
  return t.snoozedUntil !== null && new Date(t.snoozedUntil).getTime() > now;
}

function sentByMe(state: MailState, t: Thread) {
  const mine = state.accounts.find((a) => a.id === t.accountId)?.address.toLowerCase();
  return t.messages.some((m) => m.from.address.toLowerCase() === mine);
}

/** Conversations for one folder of the active account, newest first. */
export function threadsIn(state: MailState, key: FolderKey, now = Date.now()): Thread[] {
  const mine = state.threads.filter((t) => t.accountId === state.activeAccountId);
  const live = (t: Thread) => t.location !== 'trash' && t.location !== 'spam';

  let result: Thread[];
  if (key.startsWith('label:')) {
    const id = key.slice('label:'.length);
    result = mine.filter((t) => live(t) && t.labelIds.includes(id));
  } else {
    switch (key as FolderId) {
      case 'inbox':
        result = mine.filter((t) => t.location === 'inbox' && !isSnoozed(t, now));
        break;
      case 'starred':
        result = mine.filter((t) => live(t) && t.starred);
        break;
      case 'snoozed':
        result = mine.filter((t) => live(t) && isSnoozed(t, now));
        break;
      case 'important':
        result = mine.filter((t) => live(t) && t.important);
        break;
      case 'sent':
        result = mine.filter((t) => live(t) && t.location !== 'scheduled' && sentByMe(state, t));
        break;
      case 'scheduled':
        result = mine.filter((t) => t.location === 'scheduled');
        break;
      case 'all':
        result = mine.filter((t) => live(t) && t.location !== 'scheduled');
        break;
      case 'spam':
        result = mine.filter((t) => t.location === 'spam');
        break;
      case 'trash':
        result = mine.filter((t) => t.location === 'trash');
        break;
      default:
        result = [];
    }
  }
  return result.sort(byRecent);
}

export function unreadCount(state: MailState, key: FolderKey, now = Date.now()): number {
  return threadsIn(state, key, now).filter((t) => t.unread).length;
}

export function draftsForAccount(state: MailState) {
  return state.drafts
    .filter((d) => d.accountId === state.activeAccountId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Everyone the active account has exchanged mail with, for recipient suggestions. */
export function contacts(state: MailState): Address[] {
  const seen = new Map<string, Address>();
  const me = state.accounts.map((a) => a.address.toLowerCase());
  for (const t of state.threads) {
    for (const m of t.messages) {
      for (const a of [m.from, ...m.to, ...m.cc]) {
        const key = a.address.toLowerCase();
        if (!me.includes(key) && !seen.has(key)) seen.set(key, a);
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.name || a.address).localeCompare(b.name || b.address));
}

/**
 * Searches the active account. Supports the operators Gmail users already know:
 * from:, to:, subject:, label:, has:attachment, is:unread, is:starred, in:<folder>.
 */
export function search(state: MailState, query: string): Thread[] {
  const tokens = query.match(/(\w+:"[^"]+"|\w+:\S+|"[^"]+"|\S+)/g) ?? [];
  if (tokens.length === 0) return [];

  const filters: ((t: Thread) => boolean)[] = [];
  const words: string[] = [];
  const unquote = (v: string) => v.replace(/^"|"$/g, '').toLowerCase();
  const addresses = (t: Thread, field: 'from' | 'to') =>
    t.messages.flatMap((m) => (field === 'from' ? [m.from] : [...m.to, ...m.cc])).map((a) => `${a.name} ${a.address}`.toLowerCase());

  for (const token of tokens) {
    const op = token.match(/^(\w+):(.+)$/);
    if (!op) {
      words.push(unquote(token));
      continue;
    }
    const [, key, raw] = op;
    const value = unquote(raw!);
    switch (key!.toLowerCase()) {
      case 'from':
        filters.push((t) => addresses(t, 'from').some((a) => a.includes(value)));
        break;
      case 'to':
        filters.push((t) => addresses(t, 'to').some((a) => a.includes(value)));
        break;
      case 'subject':
        filters.push((t) => t.subject.toLowerCase().includes(value));
        break;
      case 'label': {
        const label = state.labels.find((l) => l.name.toLowerCase() === value);
        filters.push((t) => (label ? t.labelIds.includes(label.id) : false));
        break;
      }
      case 'has':
        if (value === 'attachment') filters.push((t) => t.messages.some((m) => m.attachments.length > 0));
        break;
      case 'is':
        if (value === 'unread') filters.push((t) => t.unread);
        if (value === 'read') filters.push((t) => !t.unread);
        if (value === 'starred') filters.push((t) => t.starred);
        if (value === 'important') filters.push((t) => t.important);
        break;
      case 'in': {
        const ids = new Set(threadsIn(state, value as FolderKey).map((t) => t.id));
        filters.push((t) => ids.has(t.id));
        break;
      }
      default:
        words.push(token.toLowerCase());
    }
  }

  return state.threads
    .filter((t) => t.accountId === state.activeAccountId)
    .filter((t) => filters.every((f) => f(t)))
    .filter((t) => {
      if (words.length === 0) return true;
      const haystack = [
        t.subject,
        ...t.messages.flatMap((m) => [m.body, m.from.name, m.from.address, ...m.to.map((a) => a.address), ...m.attachments.map((a) => a.name)]),
      ]
        .join(' ')
        .toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .sort(byRecent);
}

export const SWIPE_NAMES: Record<SwipeAction, string> = {
  archive: 'Archive',
  trash: 'Trash',
  read: 'Mark read or unread',
  snooze: 'Snooze',
  star: 'Star',
  none: 'None',
};
