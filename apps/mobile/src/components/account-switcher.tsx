import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import type { MenuAction } from '@expo/ui/community/menu';

import { AccountMenuTrigger } from './account-menu-trigger';
import { Avatar } from './avatar';
import { authClient } from '@/lib/auth-client';
import { authError } from '@/lib/auth-feedback';
import { rememberCurrentSession, signOutCurrentAccount } from '@/lib/account-sessions';
import { haptic } from '@/lib/haptics';
import { useColors } from '@/theme/colors';

type DeviceSession = typeof authClient.$Infer.Session;

/** Native anchored menu: the OS owns layout, dismissal and action hit targets. */
export function AccountMenu({ label }: { label?: string }) {
  const c = useColors();
  const { data: active } = authClient.useSession();
  const userId = active?.user.id;
  const sessionId = active?.session.id;
  const [saved, setSaved] = useState<{ owner?: string; sessions: DeviceSession[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      if (sessionId) await rememberCurrentSession();
      const result = await authClient.multiSession.listDeviceSessions();
      if (result.error) throw new Error(authError(result.error));
      const sessions = result.data ?? [];
      if (request === generation.current) {
        setSaved({ owner: userId, sessions });
        setFailed(false);
      }
      return sessions;
    } catch (error) {
      if (request === generation.current) setFailed(true);
      throw error;
    }
  }, [sessionId, userId]);

  useFocusEffect(useCallback(() => {
    void load().catch(() => undefined);
    return () => { generation.current++; };
  }, [load]));

  const sessions = saved?.owner === userId ? saved?.sessions : undefined;
  const others = (sessions ?? []).filter((item) => item.user.id !== userId);
  const shown = active ? [active, ...others] : others;
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    haptic();
    try { await action(); haptic('success'); }
    catch (error) {
      haptic('error');
      Alert.alert('Could not update accounts', error instanceof Error ? error.message : 'Please try again.');
    } finally { pending.current = false; setBusy(false); }
  };

  const onAction = (id: string) => {
    if (id === 'add') {
      void run(async () => {
        // Refresh before adding so a transient menu-load failure never disables this action.
        const current = await load();
        if (current.length >= 5) throw new Error('Up to 5 accounts can stay signed in. Sign out of one before adding another.');
        router.push({ pathname: '/sign-in', params: { add: '1', from: sessionId ?? '' } });
      });
    } else if (id === 'sign-out') {
      void run(async () => { await signOutCurrentAccount(); router.replace('/'); });
    } else if (id === 'reload') {
      void run(async () => { await load(); });
    } else {
      const item = shown.find((entry) => `account:${entry.user.id}` === id);
      if (!item || item.user.id === userId) { haptic(); return; }
      void run(async () => {
        const result = await authClient.multiSession.setActive({ sessionToken: item.session.token });
        if (result.error) throw new Error(authError(result.error));
        const refreshed = await authClient.getSession({ query: { disableCookieCache: true } });
        if (refreshed.error) throw new Error(authError(refreshed.error));
        router.replace('/');
      });
    }
  };

  const actions: MenuAction[] = [
    ...shown.map((item): MenuAction => ({
      id: `account:${item.user.id}`,
      title: item.user.email,
      image: 'person.crop.circle',
      state: item.user.id === userId ? 'on' : 'off',
      attributes: { disabled: busy },
    })),
    ...(failed || !sessions ? [{ id: 'reload', title: failed ? 'Retry loading accounts' : 'Refresh accounts', image: 'arrow.clockwise' as const, attributes: { disabled: busy } }] : []),
    { id: 'actions', title: '', displayInline: true, subactions: [
      { id: 'add', title: 'Add another account', image: 'person.crop.circle.badge.plus', attributes: { disabled: busy } },
      ...(active ? [{ id: 'sign-out', title: 'Sign out of this account', image: 'rectangle.portrait.and.arrow.right' as const, attributes: { disabled: busy, destructive: true } }] : []),
    ] },
  ];

  return <AccountMenuTrigger title="Accounts" actions={actions} onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)} style={{ width: label ? 210 : 44, height: 44 }}>
    <View pointerEvents="none" accessible accessibilityRole="button" accessibilityLabel={label ?? `Switch account. ${active?.user.email ?? ''}`} style={{ width: label ? 210 : 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      {busy ? <ActivityIndicator color={c.tint} /> : label ? <Text style={{ color: c.tint, fontSize: 16, fontWeight: '600' }}>{label}</Text> : <Avatar name={active?.user.name ?? ''} address={active?.user.email ?? ''} size={34} />}
    </View>
  </AccountMenuTrigger>;
}
