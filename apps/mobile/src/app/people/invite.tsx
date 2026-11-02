import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { Row, Section } from '@/components/grouped-list';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

type Role = { id: string; title: string; description: string; grantableOn: ('tenant' | 'mailbox')[]; permissions: string[] };
type Mailbox = { id: string; address: string };

export default function InvitePerson() {
  const c = useColors();
  const workspace = useActiveWorkspace();
  const [roles, setRoles] = useState<Role[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState<string>('workspace');
  const [selectedRole, setRole] = useState('roles/mailUser');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    api<{ roles: Role[] }>('/v1/roles').then((r) => setRoles(r.roles)).catch(() => undefined);
    api<{ mailboxes: Mailbox[] }>(`/v1/tenants/${workspace.id}/mailboxes`).then((r) => setMailboxes(r.mailboxes)).catch(() => undefined);
  }, [workspace]);

  const kind = scope === 'workspace' ? 'tenant' : 'mailbox';
  const held = new Set(workspace?.permissions ?? []);
  // Only offer roles this admin is allowed to hand out on the chosen scope.
  const offered = roles.filter((r) => r.grantableOn.includes(kind) && r.permissions.every((p) => p.startsWith('mail.') || held.has(p)) && (r.id !== 'roles/owner' || workspace?.roles.includes('roles/owner')));

  const role = offered.some((r) => r.id === selectedRole) ? selectedRole : (offered[0]?.id ?? selectedRole);

  const send = async () => {
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const resource = scope === 'workspace' ? `tenants/${workspace.id}` : `tenants/${workspace.id}/mailboxes/${scope}`;
      const result = await api<{ inviteUrl: string }>(`/v1/tenants/${workspace.id}/invites`, { method: 'POST', body: { email: email.trim(), role, resource } });
      setLink(result.inviteUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invite.');
    } finally {
      setBusy(false);
    }
  };

  if (link) {
    return (
      <KeyboardAwareScrollView bottomOffset={24} contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={styles.wrap}>
        <Stack.Screen options={{ title: 'Invite ready' }} />
        <Text style={[styles.title, { color: c.label }]}>Send this link to {email.trim()}</Text>
        <Text style={[styles.body, { color: c.secondaryLabel }]}>
          Emailed invites start once sending is set up for your domain. Until then, share the link yourself. It works once, only for {email.trim()}, and expires in 7 days.
        </Text>
        <View style={[styles.link, { backgroundColor: c.cell }]}>
          <Text selectable style={{ color: c.label, fontSize: 14 }}>
            {link}
          </Text>
        </View>
        <Button variant="brand" title="Share link" onPress={() => Share.share({ message: `You have been invited to ${workspace?.name} on Sendraa: ${link}` })} />
        <Button variant="plain" title="Copy link" onPress={() => Clipboard.setStringAsync(link)} />
        <Button variant="plain" title="Done" onPress={() => router.back()} />
      </KeyboardAwareScrollView>
    );
  }

  return (
    <KeyboardAwareScrollView bottomOffset={24} contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>
      <Stack.Screen options={{ title: 'Invite someone' }} />
      <View style={styles.fieldWrap}>
        <Field label="Their email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoFocus placeholder="priya@gmail.com" />
      </View>

      <Section title="Access to" footer="Give access to one mailbox, such as hello@, or to the whole workspace.">
        <Row title="Whole workspace" checked={scope === 'workspace'} onPress={() => setScope('workspace')} />
        {mailboxes.map((m) => (
          <Row key={m.id} title={m.address} checked={scope === m.id} onPress={() => setScope(m.id)} />
        ))}
      </Section>

      <Section title="Role">
        {offered.map((r) => (
          <Row key={r.id} title={r.title} subtitle={r.description} checked={role === r.id} onPress={() => setRole(r.id)} />
        ))}
      </Section>

      <View style={styles.actions}>
        <ErrorText>{error}</ErrorText>
        <Button variant="brand" title="Create invite" onPress={send} loading={busy} disabled={!email.trim() || offered.length === 0} />
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 21 },
  link: { borderRadius: 12, padding: 14 },
  fieldWrap: { marginHorizontal: 16, marginTop: 20 },
  actions: { marginHorizontal: 16, marginTop: 24, gap: 10 },
});
