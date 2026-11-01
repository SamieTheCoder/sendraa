export type Address = { name: string; address: string };

export type Attachment = { id: string; name: string; size: number; type: string };

export type Message = {
  id: string;
  from: Address;
  to: Address[];
  cc: Address[];
  /** ISO timestamp. */
  date: string;
  body: string;
  attachments: Attachment[];
};

/** Where a conversation lives. Starred, snoozed and labels are views over these. */
export type Location = 'inbox' | 'archive' | 'sent' | 'scheduled' | 'spam' | 'trash';

export type Thread = {
  id: string;
  accountId: string;
  subject: string;
  messages: Message[];
  location: Location;
  labelIds: string[];
  starred: boolean;
  unread: boolean;
  important: boolean;
  /** ISO timestamp. Hidden from the inbox until this time. */
  snoozedUntil: string | null;
  /** ISO timestamp for scheduled sends. */
  scheduledAt: string | null;
};

export type Account = {
  id: string;
  address: string;
  name: string;
  /** Shared mailboxes are reached by several members, like hello@ or support@. */
  shared: boolean;
};

export type Label = { id: string; name: string; color: string };

export type DraftMode = 'new' | 'reply' | 'replyAll' | 'forward';

export type Draft = {
  id: string;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: Attachment[];
  mode: DraftMode;
  /** Thread being replied to or forwarded. */
  threadId: string | null;
  updatedAt: string;
};

export type SwipeAction = 'archive' | 'trash' | 'read' | 'snooze' | 'star' | 'none';

export type Vacation = {
  enabled: boolean;
  subject: string;
  message: string;
  contactsOnly: boolean;
};

export type AccountSettings = {
  signature: string;
  signatureEnabled: boolean;
  vacation: Vacation;
};

export type Settings = {
  accounts: Record<string, AccountSettings>;
  /** Swipe right, revealing the leading edge. */
  swipeLeading: SwipeAction;
  /** Swipe left, revealing the trailing edge. */
  swipeTrailing: SwipeAction;
  conversationView: boolean;
  undoSendSeconds: 5 | 10 | 20 | 30;
  defaultReply: 'reply' | 'replyAll';
  showAvatars: boolean;
  notifications: 'all' | 'important' | 'none';
};

/** System folders the user can open. Starred, snoozed, important, drafts and all are views. */
export type FolderId =
  | 'inbox'
  | 'starred'
  | 'snoozed'
  | 'important'
  | 'sent'
  | 'scheduled'
  | 'drafts'
  | 'all'
  | 'spam'
  | 'trash';

/** A folder, or a user label written as `label:<id>`. */
export type FolderKey = FolderId | `label:${string}`;
