import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Row, Section, SwitchRow } from '@/components/grouped-list';
import { SWIPE_NAMES } from '@/mail/selectors';
import { activeAccount, resetSampleData, setActiveAccount, updateSettings, useMail } from '@/mail/store';
import { authClient } from '@/lib/auth-client';
import { ROLE_TITLES, getMe, useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

const NOTIFY_NAMES = { all: 'All new mail', important: 'Important only', none: 'Off' } as const;

export default function SettingsScreen() {
  const state = useMail();
  const c = useColors();
  const account = activeAccount(state);
  const accountSettings = state.settings.accounts[account.id];
  const s = state.settings;
  const workspace = useActiveWorkspace();
  const me = getMe();
  const canManagePeople = workspace?.permissions.includes('members.list') ?? false;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={{ paddingBottom: 48 }}>
      {workspace ? (
        <Section title="Workspace" footer={me ? `Signed in as ${me.user.email}${me.signedInWithCloudflare ? ' with Cloudflare' : ''}.` : undefined}>
          <Row title={workspace.name} subtitle={workspace.roles.map((r) => ROLE_TITLES[r] ?? r).join(', ') || 'Access to some mailboxes'} />
          {workspace.linkedToCloudflare && workspace.permissions.includes('domains.list') ? (
            <Row
              title="Email setup"
              value={{ ready: 'Ready', running: 'In progress', failed: 'Needs attention', not_started: 'Not set up' }[workspace.setupStatus]}
              navigates
              onPress={() => router.push('/setup')}
            />
          ) : null}
          {canManagePeople ? <Row title="People and access" navigates onPress={() => router.push('/people')} /> : null}
        </Section>
      ) : null}

      <Section
        title="Mailboxes"
        footer={
          state.accounts.some((a) => a.live)
            ? 'Mailboxes your admin has given you. The one you pick is shown in Mail.'
            : 'Mailboxes your admin has given you. The one you pick is shown in Mail. This is sample mail until email setup is finished.'
        }
      >
        {state.accounts.map((a) => (
          <Row
            key={a.id}
            title={a.name}
            subtitle={a.shared ? `${a.address} · Shared` : a.address}
            checked={a.id === state.activeAccountId}
            onPress={() => setActiveAccount(a.id)}
            leading={<Avatar name={a.name} address={a.address} size={34} />}
          />
        ))}
      </Section>

      <Section title={account.address}>
        <Row
          title="Signature"
          value={accountSettings?.signatureEnabled ? 'On' : 'Off'}
          navigates
          onPress={() => router.push('/settings/signature')}
        />
        <Row
          title="Vacation responder"
          value={accountSettings?.vacation.enabled ? 'On' : 'Off'}
          navigates
          onPress={() => router.push('/settings/vacation')}
        />
      </Section>

      <Section title="Inbox">
        <SwitchRow
          title="Conversation view"
          subtitle="Group replies into one conversation"
          value={s.conversationView}
          onValueChange={(conversationView) => updateSettings({ conversationView })}
        />
        <SwitchRow title="Sender images" value={s.showAvatars} onValueChange={(showAvatars) => updateSettings({ showAvatars })} />
        <Row title="Swipe actions" value={`${SWIPE_NAMES[s.swipeLeading]}, ${SWIPE_NAMES[s.swipeTrailing]}`} navigates onPress={() => router.push('/settings/swipe')} />
        <Row title="Labels" value={String(state.labels.length)} navigates onPress={() => router.push('/settings/labels')} />
      </Section>

      <Section title="Sending">
        <Row title="Undo send" value={`${s.undoSendSeconds} seconds`} navigates onPress={() => router.push({ pathname: '/settings/option', params: { key: 'undoSend' } })} />
        <Row
          title="Default reply"
          value={s.defaultReply === 'reply' ? 'Reply' : 'Reply all'}
          navigates
          onPress={() => router.push({ pathname: '/settings/option', params: { key: 'defaultReply' } })}
        />
      </Section>

      <Section title="Notifications">
        <Row title="Notify me about" value={NOTIFY_NAMES[s.notifications]} navigates onPress={() => router.push({ pathname: '/settings/option', params: { key: 'notifications' } })} />
      </Section>

      <Section
        title="About"
        footer="Mail is sample data for now. Northwind Labs and its people are invented, and nothing you send leaves this device until the mail service is connected."
      >
        <Row title="Version" value={Constants.expoConfig?.version ?? '1.0.0'} />
        <Row
          title="Reset sample mail"
          tinted
          onPress={() =>
            Alert.alert('Reset sample mail?', 'This replaces your changes, drafts and settings with the original sample data.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: resetSampleData },
            ])
          }
        />
      </Section>

      <Section>
        <Row
          title="Sign out"
          destructive
          onPress={() =>
            Alert.alert('Sign out?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void authClient.signOut() },
            ])
          }
        />
      </Section>

      <View style={styles.brand}>
        <Text style={[styles.brandText, { color: c.tertiaryLabel }]}>sendraa</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', paddingTop: 28 },
  brandText: { fontSize: 13, letterSpacing: 0.5 },
});
