import { useEffect, useSyncExternalStore } from 'react';

import { api } from './api';

export type Workspace = { id: string; name: string; roles: string[]; permissions: string[] };

export type Me = {
  user: { id: string; email: string; name: string };
  signedInWithCloudflare: boolean;
  canCreateWorkspace: boolean;
  workspaces: Workspace[];
};

type State =
  | { status: 'idle' }
  | { status: 'loading'; userId: string }
  | { status: 'ready'; userId: string; me: Me; activeId: string | null }
  | { status: 'error'; userId: string; message: string };

let state: State = { status: 'idle' };
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};

export async function loadMe(userId: string) {
  if (state.status === 'idle' || ('userId' in state && state.userId !== userId)) set({ status: 'loading', userId });
  try {
    const me = await api<Me>('/v1/me');
    const previous = state.status === 'ready' ? state.activeId : null;
    const activeId = me.workspaces.some((w) => w.id === previous) ? previous : (me.workspaces[0]?.id ?? null);
    set({ status: 'ready', userId, me, activeId });
  } catch (err) {
    set({ status: 'error', userId, message: err instanceof Error ? err.message : 'Could not load your workspace.' });
  }
}

export function resetMe() {
  set({ status: 'idle' });
}

export function setActiveWorkspace(id: string) {
  if (state.status === 'ready') set({ ...state, activeId: id });
}

/** Loads the signed-in person's workspaces and roles whenever the user changes. */
export function useMe(userId: string | undefined): State {
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  useEffect(() => {
    if (!userId) resetMe();
    else if (snapshot.status === 'idle' || ('userId' in snapshot && snapshot.userId !== userId)) void loadMe(userId);
  }, [userId, snapshot]);
  return snapshot;
}

export function useActiveWorkspace(): Workspace | null {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  if (s.status !== 'ready') return null;
  return s.me.workspaces.find((w) => w.id === s.activeId) ?? null;
}

export function getMe(): Me | null {
  return state.status === 'ready' ? state.me : null;
}

export const ROLE_TITLES: Record<string, string> = {
  'roles/owner': 'Owner',
  'roles/admin': 'Admin',
  'roles/mailboxAdmin': 'Mailbox admin',
  'roles/billingAdmin': 'Billing admin',
  'roles/auditor': 'Auditor',
  'roles/mailUser': 'Mail user',
  'roles/mailReader': 'Mail reader',
};
