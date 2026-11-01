import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Row, Section } from '@/components/grouped-list';
import { api } from '@/lib/api';
import { ROLE_TITLES, getMe, useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';
import { ToolbarIcon } from '@/theme/icons';

type Member = { id: string; email: string; name: string; bindings: { resource: string; role: string }[] };
type Invite = { id: string; email: string; resource: string; role: string; expires_at: string };
type Mailbox = { id: string; address: string };

export default function People() {
  const c = useColors();
  const workspace = useActiveWorkspace();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const canInvite = workspace?.permissions.includes('members.invite') ?? false;
  const canRemove = workspace?.permissions.includes('members.remove') ?? false;

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      const [m, i, b] = await Promise.all([
        api<{ members: Member[] }>(`/v1/tenants/${workspace.id}/members`),
        api<{ invites: Invite[] }>(`/v1/tenants/${workspace.id}/invites`),
        api<{ mailboxes: Mailbox[] }>(`/v1/tenants/${workspace.id}/mailboxes`),
      ]);
      setMembers(m.members);
      setInvites(i.invites);
      setMailboxes(b.mailboxes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load people.');
    }
  }, [workspace]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** "Admin" for a workspace role, "Mail user · hello@" for a mailbox role. */
  const describe = (b: { resource: string; role: string }) => {
    const title = ROLE_TITLES[b.role] ?? b.role;
    const mailboxId = b.resource.split('/mailboxes/')[1];
    if (!mailboxId) return title;
    const address = mailboxes.find((m) => m.id === mailboxId)?.address ?? 'a mailbox';
    return `${title} · ${address}`;
  };

  const remove = (m: Member) =>
    Alert.alert(`Remove ${m.name || m.email}?`, 'They lose access to every mailbox in this workspace straight away.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/v1/tenants/${workspace!.id}/members/${m.id}`, { method: 'DELETE' });
            await load();
          } catch (err) {
            Alert.alert('Could not remove', err instanceof Error ? err.message : 'Try again.');
          }
        },
      },
    ]);

  const revoke = (i: Invite) =>
    Alert.alert(`Withdraw the invite to ${i.email}?`, 'The link stops working.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          await api(`/v1/tenants/${workspace!.id}/invites/${i.id}`, { method: 'DELETE' }).catch(() => undefined);
          await load();
        },
      },
    ]);

  const me = getMe();

  return (
    <>
      <Stack.Screen options={{ title: 'People and access' }} />
      {canInvite ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon={ToolbarIcon.compose} accessibilityLabel="Invite someone" onPress={() => router.push('/people/invite')} />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: c.groupedBackground }}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {error ? <Text style={[styles.error, { color: c.red }]}>{error}</Text> : null}
        {!members && !error ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}

        {members ? (
          <Section title={`${members.length} ${members.length === 1 ? 'person' : 'people'}`} footer="Roles on the workspace apply to every mailbox in it. Roles on a mailbox apply only there.">
            {members.map((m) => (
              <Row
                key={m.id}
                title={m.id === me?.user.id ? `${m.name || m.email} (you)` : m.name || m.email}
                subtitle={m.bindings.length ? m.bindings.map(describe).join('\n') : 'No access yet'}
                leading={<Avatar name={m.name} address={m.email} size={34} />}
                onPress={canRemove && m.id !== me?.user.id ? () => remove(m) : undefined}
              />
            ))}
          </Section>
        ) : null}

        {invites.length > 0 ? (
          <Section title="Invited" footer="Invites expire after 7 days. Tap one to withdraw it.">
            {invites.map((i) => (
              <Row key={i.id} title={i.email} subtitle={describe(i)} onPress={canInvite ? () => revoke(i) : undefined} />
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 14, marginHorizontal: 32, marginTop: 16 },
});
