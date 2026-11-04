import Constants from 'expo-constants';
import { router } from 'expo-router';
import { HapticPressable as Pressable } from '@/components/haptic-pressable';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AddressStrip } from '@/components/address-strip';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { Lockup } from '@/components/logo';
import { Row, Section, SwitchRow } from '@/components/grouped-list';
import { SWIPE_NAMES } from '@/mail/selectors';
import { activeAccount, resetSampleData, setActiveAccount, updateSettings, useMail } from '@/mail/store';
import { signOutCurrentAccount } from '@/lib/account-sessions';
import { ROLE_TITLES, getMe, useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

const NOTIFY_NAMES = { all: 'All mail', important: 'Important', none: 'Off' } as const;
const SETUP = {
  ready: { label: 'Ready', tone: 'good' },
  running: { label: 'In progress', tone: 'warn' },
  failed: { label: 'Needs attention', tone: 'bad' },
  not_started: { label: 'Not set up', tone: 'none' },
} as const;
const version = Constants.expoConfig?.version ?? '1.0.0';

export default function SettingsScreen() {
  const state = useMail();
  const c = useColors();
  const account = activeAccount(state);
  const accountSettings = state.settings.accounts[account.id];
  const s = state.settings;
  const workspace = useActiveWorkspace();
  const me = getMe();
  const canManagePeople = workspace?.permissions.includes('members.list') ?? false;

  const live = state.accounts.some((a) => a.live);
  const setup = workspace ? SETUP[workspace.setupStatus] : null;
  const name = me?.user.name || account.name;
  const email = me?.user.email ?? account.address;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={{ paddingBottom: 48 }}>
      {/* Who you are comes first: it is the one thing people check here, and it opens account security. */}
      <Pressable
        onPress={() => router.push('/account-security')}
        style={({ pressed }) => [styles.profile, { backgroundColor: pressed ? c.fill : c.cell }]}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${email}. Account and security`}
      >
        <Avatar name={name} address={email} size={56} />
        <View style={styles.profileText}>
          <Text style={[styles.profileName, { color: c.label }]} numberOfLines={1}>{name}</Text>
          <AddressStrip address={email} ground={c.cell} size="small" />
          <Text style={[styles.profileMeta, { color: c.secondaryLabel }]} numberOfLines={1}>
            {me?.signedInWithCloudflare ? 'Signed in with Cloudflare' : 'Signed in with email'} · Account and security
          </Text>
        </View>
        <Icon ios="chevron.right" android="chevron_right" size={14} color={c.tertiaryLabel} />
      </Pressable>

      <Section title="This device" inset="icon">
        <Row icon={{ ios: 'bell', android: 'notifications' }} title="Notifications" subtitle="Enable alerts and copy verification codes" value={NOTIFY_NAMES[s.notifications]} navigates onPress={() => router.push('/notifications')} />
      </Section>

      {workspace ? (
        <Section title="Workspace" inset="icon">
          <Row
            icon={{ ios: 'building.2', android: 'domain' }}
            title={workspace.name}
            subtitle={workspace.roles.map((r) => ROLE_TITLES[r] ?? r).join(', ') || 'Access to some mailboxes'}
          />
          {workspace.linkedToCloudflare && workspace.permissions.includes('domains.list') && setup ? (
            <Row
              icon={{ ios: 'globe', android: 'language' }}
              title="Email setup"
              value={setup.label}
              valueColor={setup.tone === 'good' ? c.green : setup.tone === 'warn' ? c.orange : setup.tone === 'bad' ? c.red : undefined}
              navigates
              onPress={() => router.push('/setup')}
            />
          ) : null}
          {canManagePeople ? <Row icon={{ ios: 'person.2', android: 'group' }} title="People and access" navigates onPress={() => router.push('/people')} /> : null}
          {workspace.permissions.includes('mailboxes.update') ? <Row icon={{ ios: 'tray.2', android: 'inbox' }} title="Manage mailboxes" navigates onPress={() => router.push('/mailboxes')} /> : null}
          {workspace.permissions.includes('sending.configure') ? <Row icon={{ ios: 'paperplane', android: 'send' }} title="Sending" navigates onPress={() => router.push('/sending')} /> : null}
        </Section>
      ) : null}

      <Section
        title="Mailboxes"
        footer={live ? 'The mailbox you pick is the one shown in Mail.' : 'The mailbox you pick is the one shown in Mail. This is sample mail until email setup is finished.'}
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

      <Section title={`For ${account.address}`} inset="icon">
        <Row
          icon={{ ios: 'signature', android: 'signature' }}
          title="Signature"
          value={accountSettings?.signatureEnabled ? 'On' : 'Off'}
          navigates
          onPress={() => router.push('/settings/signature')}
        />
        <Row
          icon={{ ios: 'airplane', android: 'flight' }}
          title="Vacation responder"
          value={accountSettings?.vacation.enabled ? 'On' : 'Off'}
          valueColor={accountSettings?.vacation.enabled ? c.green : undefined}
          navigates
          onPress={() => router.push('/settings/vacation')}
        />
      </Section>

      <Section title="Inbox" inset="icon">
        <SwitchRow
          title="Conversation view"
          subtitle="Group replies into one conversation"
          value={s.conversationView}
          onValueChange={(conversationView) => updateSettings({ conversationView })}
        />
        <SwitchRow title="Sender images" value={s.showAvatars} onValueChange={(showAvatars) => updateSettings({ showAvatars })} />
        <Row icon={{ ios: 'hand.draw', android: 'swipe' }} title="Swipe actions" value={`${SWIPE_NAMES[s.swipeLeading]}, ${SWIPE_NAMES[s.swipeTrailing]}`} navigates onPress={() => router.push('/settings/swipe')} />
        <Row icon={{ ios: 'tag', android: 'label' }} title="Labels" value={String(state.labels.length)} navigates onPress={() => router.push('/settings/labels')} />
      </Section>

      <Section title="Sending and alerts" inset="icon">
        <SwitchRow title="Haptic feedback" subtitle="Gentle feedback for taps and actions" value={s.haptics} onValueChange={(haptics)=>updateSettings({haptics})}/>
        {!live ? <Row icon={{ ios: 'arrow.uturn.backward', android: 'undo' }} title="Undo send" value={`${s.undoSendSeconds} s`} navigates onPress={() => router.push({ pathname: '/settings/option', params: { key: 'undoSend' } })} /> : null}
        <Row
          icon={{ ios: 'arrowshape.turn.up.left', android: 'reply' }}
          title="Default reply"
          value={s.defaultReply === 'reply' ? 'Reply' : 'Reply all'}
          navigates
          onPress={() => router.push({ pathname: '/settings/option', params: { key: 'defaultReply' } })}
        />
      </Section>

      <Section title="About" footer={live ? 'Your workspace mail is stored in its own Cloudflare account.' : undefined} inset="icon">
        <Row icon={{ ios: 'hand.raised', android: 'privacy_tip' }} title="Privacy Policy" navigates onPress={() => router.push({ pathname: '/legal', params: { document: 'privacy' } })} />
        <Row icon={{ ios: 'doc.text', android: 'description' }} title="Terms of Service" navigates onPress={() => router.push({ pathname: '/legal', params: { document: 'terms' } })} />
        {!live ? <Row
          icon={{ ios: 'arrow.counterclockwise', android: 'restart_alt' }}
          title="Reset sample mail"
          onPress={() =>
            Alert.alert('Reset sample mail?', 'This replaces your changes, drafts and settings with the original sample data.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: resetSampleData },
            ])
          }
        /> : null}
      </Section>

      <Section>
        <Pressable
          onPress={() =>
            Alert.alert('Sign out of this account?', 'Your other saved accounts will stay signed in.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOutCurrentAccount().catch((err)=>Alert.alert('Could not sign out',err.message)) },
            ])
          }
          style={({ pressed }) => [styles.signOut, pressed && { backgroundColor: c.fill }]}
          accessibilityRole="button"
        >
          <Text style={[styles.signOutText, { color: c.red }]}>Sign out</Text>
        </Pressable>
      </Section>

      <View style={styles.brand} accessible accessibilityLabel={`Sendraa version ${version}`}>
        <Lockup size={22} color={c.tertiaryLabel} />
        <Text style={[styles.version, { color: c.tertiaryLabel }]}>Version {version}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 16 },
  profileText: { flex: 1, gap: 6 },
  profileName: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  profileMeta: { fontSize: 13 },
  signOut: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  signOutText: { fontSize: 17, fontWeight: '600' },
  brand: { alignItems: 'center', gap: 6, paddingTop: 32 },
  version: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
