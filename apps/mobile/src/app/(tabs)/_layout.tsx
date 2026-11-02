import { NativeTabs } from 'expo-router/native-tabs';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { unreadCount } from '@/mail/selectors';
import { useMail } from '@/mail/store';
import { useColors } from '@/theme/colors';

export default function TabLayout() {
  const state = useMail();
  const unread = useMemo(() => unreadCount(state, 'inbox'), [state]);
  const c = useColors();
  const insets = useSafeAreaInsets();

  if (Platform.OS === 'android') {
    return (
      <Tabs screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.tint as string,
        tabBarInactiveTintColor: c.secondaryLabel as string,
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
        // Reserve the system navigation inset once, below a compact 56dp bar.
        tabBarStyle: { height: 56 + insets.bottom, paddingTop: 4, paddingBottom: insets.bottom, backgroundColor: c.cell, borderTopWidth: 0, elevation: 0 },
        tabBarBadgeStyle: { backgroundColor: c.brand, color: c.onBrand },
      }}>
        <Tabs.Screen name="mail" options={{ title: 'Mail', tabBarBadge: unread || undefined, tabBarIcon: ({ color }) => <Icon ios="envelope" android="mail" color={color} size={24} /> }} />
        <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color }) => <Icon ios="magnifyingglass" android="search" color={color} size={24} /> }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color }) => <Icon ios="gearshape" android="settings" color={color} size={24} /> }} />
      </Tabs>
    );
  }

  return (
    <NativeTabs tintColor={c.tint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="mail">
        <NativeTabs.Trigger.Label>Mail</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'envelope', selected: 'envelope.fill' }} md="mail" />
        {unread > 0 ? <NativeTabs.Trigger.Badge>{String(unread)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
