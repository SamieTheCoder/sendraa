import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Row, Section } from '@/components/grouped-list';
import { Icon } from '@/components/icon';
import { FOLDERS, draftsForAccount, unreadCount } from '@/mail/selectors';
import { activeAccount, setActiveAccount, setFolder, useMail } from '@/mail/store';
import type { FolderKey } from '@/mail/types';
import { useColors } from '@/theme/colors';

/** An inset-aware side panel, presented above the current mailbox. */
export default function Folders() {
  const state = useMail();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const c = useColors();
  const account = activeAccount(state);
  const choose = (folder: FolderKey) => { setFolder(folder); router.back(); };
  return <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}>
    <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close mailboxes" />
    <View accessibilityViewIsModal style={{ width: Math.min(width * 0.88, 360), flex: 1, backgroundColor: c.groupedBackground, paddingTop: insets.top, paddingBottom: insets.bottom }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', color: c.label }}>Mailboxes</Text>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close mailboxes" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Icon ios="xmark" android="close" color={c.label} /></Pressable>
    </View>
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Stack.Screen options={{ title: 'Mailboxes' }} />
    <View style={{ paddingHorizontal: 32, paddingTop: 24, gap: 4 }}>
      <Text style={{ color: c.label, fontSize: 20, fontWeight: '600' }}>{account.name}</Text>
      <Text selectable style={{ color: c.secondaryLabel, fontSize: 15 }}>{account.address}</Text>
    </View>
    <Section>
      {FOLDERS.map(f => {
        const count = f.id === 'drafts' ? draftsForAccount(state).length : unreadCount(state, f.id);
        return <Row key={f.id} title={f.title} value={count ? String(count) : undefined} checked={state.folder === f.id} onPress={() => choose(f.id)} leading={<Icon ios={f.ios} android={f.android as never} size={22} color={state.folder === f.id ? c.tint : c.secondaryLabel} />} />;
      })}
    </Section>
    {state.labels.length ? <Section title="Labels">
      {state.labels.map(label => <Row key={label.id} title={label.name} checked={state.folder === `label:${label.id}`} onPress={() => choose(`label:${label.id}`)} leading={<Icon ios="tag" android="label" size={22} color={c.secondaryLabel} />} />)}
    </Section> : null}
    {state.accounts.length > 1 ? <Section title="Switch mailbox">
      {state.accounts.map(a => <Row key={a.id} title={a.name} subtitle={a.address} checked={a.id === account.id} onPress={() => { setActiveAccount(a.id); choose('inbox'); }} />)}
    </Section> : null}
  </ScrollView></View></View>;
}
