import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Button, ErrorText } from '@/components/form';
import { Row, Section } from '@/components/grouped-list';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

export type ManagedMailbox = { id: string; address: string; display_name: string; shared: boolean; synced_at: string | null; owner_user_id: string | null; account_user_id: string | null; deleting_at: string | null };
export default function Mailboxes() {
  const c = useColors(); const workspace = useActiveWorkspace();
  const [mailboxes,setMailboxes] = useState<ManagedMailbox[] | null>(null); const [error,setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    if (!workspace) return;
    let active = true;
    api<{ mailboxes: ManagedMailbox[] }>(`/v1/tenants/${workspace.id}/mailboxes?manage=true`).then((r) => { if (active) { setMailboxes(r.mailboxes); setError(null); } }).catch((e: Error) => active && setError(e.message));
    return () => { active = false; };
  }, [workspace]));
  return <ScrollView style={{ backgroundColor: c.groupedBackground }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 48 }}>
    <Stack.Screen options={{ title: 'Manage mailboxes' }} />
    <View style={{ padding: 20, gap: 12 }}><ErrorText>{error}</ErrorText>{workspace?.permissions.includes('mailboxes.create') ? <Button title="Create mailbox" variant="brand" onPress={() => router.push('/mailboxes/new')} /> : null}</View>
    {!mailboxes && !error ? <ActivityIndicator /> : null}
    <Section title={`${mailboxes?.length ?? 0} mailboxes`} footer="Create an address for a person or a shared inbox. Give existing members access, or invite someone to create their own sign-in.">
      {mailboxes?.map((m) => <Row key={m.id} title={m.address} subtitle={`${m.display_name || (m.shared ? 'Shared mailbox' : 'Personal mailbox')} · ${m.synced_at ? 'Active' : 'Needs activation'}`} navigates onPress={() => router.push({ pathname: '/mailboxes/[id]', params: { id: m.id } })} />)}
    </Section>
  </ScrollView>;
}
