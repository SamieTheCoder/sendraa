import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { useActiveWorkspace } from '@/lib/workspace';

import { connectWorkspace, refreshMailbox } from './live';
import { useMail } from './store';

/**
 * Connects the mail store to the workspace once its email setup is ready, and
 * keeps the active mailbox fresh: on open, on mailbox switch, when the app
 * returns to the foreground, and on pull to refresh.
 */
export function useLiveMail() {
  const workspace = useActiveWorkspace();
  const { activeAccountId, accounts } = useMail();
  const ready = workspace?.setupStatus === 'ready';
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useFocusEffect(useCallback(() => {
    if (!ready || !workspace) return;
    let current = true;
    connectWorkspace(workspace.id)
      .then(() => { if (current) { setConnected(true);setError(null); } })
      .catch((err) => current && setError(err instanceof Error ? err.message : 'Could not load your mailboxes.'));
    return () => { current = false; };
  }, [ready, workspace]));

  const live = connected && accounts.some((a) => a.id === activeAccountId && a.live && !a.unavailable);

  const refresh = useCallback(async () => {
    if (!live) return;
    try {
      await refreshMailbox(activeAccountId);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your mail.');
    }
  }, [live, activeAccountId]);

  useEffect(() => {
    // The network callback, not the effect itself, updates state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);

  return { live, error, updatedAt, refresh };
}
