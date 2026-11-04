import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { Row, Section, SwitchRow } from '@/components/grouped-list';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

type Role = { id: string; title: string; description: string; grantableOn: ('tenant' | 'mailbox')[]; permissions: string[] };
type Mailbox = { id: string; address: string; shared: boolean; owner_user_id: string | null; deleting_at: string | null };

export default function InvitePerson() {
  const { mailboxId } = useLocalSearchParams<{ mailboxId?: string }>();
  const c = useColors();
  const workspace = useActiveWorkspace();
  const [mode, setMode] = useState<'new' | 'existing'>(mailboxId ? 'existing' : 'new');
  const [domains, setDomains] = useState<{id:string;name:string;verified_at:string|null}[]>([]);
  const [domainId, setDomainId] = useState('');
  const [localPart, setLocalPart] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState<string>(mailboxId ?? 'workspace');
  const [selectedRole, setRole] = useState('roles/mailUser');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [emailInvite,setEmailInvite] = useState(true);
  const [delivery,setDelivery] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    api<{domains:{id:string;name:string;verified_at:string|null}[]}>(`/v1/tenants/${workspace.id}/domains`).then((r) => { const ready=r.domains.filter((d)=>d.verified_at); setDomains(ready); setDomainId(ready[0]?.id ?? ''); }).catch((e:Error)=>setError(e.message));
    api<{ roles: Role[] }>('/v1/roles').then((r) => setRoles(r.roles)).catch(() => undefined);
    api<{ mailboxes: Mailbox[] }>(`/v1/tenants/${workspace.id}/mailboxes${workspace.permissions.includes('mailboxes.update') ? '?manage=true' : ''}`).then((r) => setMailboxes(r.mailboxes)).catch((e: Error) => setError(e.message));
  }, [workspace]);

  const createsAddress = mode === 'new' && workspace?.permissions.includes('mailboxes.create');
  const kind = scope === 'workspace' ? 'tenant' : 'mailbox';
  const held = new Set(workspace?.permissions ?? []);
  // Only offer roles this admin is allowed to hand out on the chosen scope.
  const offered = roles.filter((r) => r.grantableOn.includes(kind) && r.permissions.every((p) => p.startsWith('mail.') || held.has(p)) && (r.id !== 'roles/owner' || workspace?.roles.includes('roles/owner')));

  const role = offered.some((r) => r.id === selectedRole) ? selectedRole : (offered[0]?.id ?? selectedRole);

  const send = async () => {
    if (!workspace || busy) return;
    setBusy(true);
    setError(null);
    try {
      const resource = scope === 'workspace' ? `tenants/${workspace.id}` : `tenants/${workspace.id}/mailboxes/${scope}`;
      const result = await api<{ webUrl: string; emailSent:boolean; deliveryError:string|null; activationError:string|null; sendingNotice:string|null }>(`/v1/tenants/${workspace.id}/invites`, { method: 'POST', body: { email: email.trim(), role:createsAddress ? 'roles/mailUser' : role, resource:createsAddress ? undefined : resource, emailInvite, newMailbox:createsAddress ? {localPart,domainId,displayName} : undefined } });
      setDelivery([result.emailSent ? 'The invitation email was accepted by your sending provider.' : result.deliveryError, result.activationError, result.sendingNotice].filter(Boolean).join(' '));
      setLink(result.webUrl);
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
        <Text style={[styles.title, { color: c.label }]}>Invitation for {email.trim()}</Text>
        <Text style={[styles.body, { color: c.secondaryLabel }]}>
          {delivery ?? 'Share this link with the person you invited.'} It works once, only for {email.trim()}, and expires in 7 days. They will choose their own password.
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
        <Field label="Personal email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoFocus placeholder="priya@gmail.com" />
      </View>

      {workspace?.permissions.includes('mailboxes.create') ? <Section title="Invitation type">
        <Row title="Create a work address" subtitle="A new mailbox just for this person" checked={mode === 'new'} onPress={busy ? undefined : () => setMode('new')} />
        <Row title="Existing access" subtitle="Invite to an existing mailbox or workspace" checked={mode === 'existing'} onPress={busy ? undefined : () => setMode('existing')} />
      </Section> : null}
      {createsAddress ? <>
        <View style={[styles.fieldWrap,{gap:16}]}>
          <Field label="Name" value={displayName} onChangeText={setDisplayName} placeholder="Priya Sharma" editable={!busy} />
          <Field label="Work email" value={localPart} onChangeText={setLocalPart} autoCapitalize="none" autoCorrect={false} placeholder="priya" editable={!busy} />
          <Text style={{color:c.secondaryLabel}}>{localPart || 'name'}@{domains.find((d)=>d.id===domainId)?.name ?? 'your domain'}</Text>
        </View>
        <Section title="Domain" footer="The personal email receives the invitation and is used for recovery. They create a separate work login and password, even if they already use Sendraa. Only they can open this mailbox; admins manage the address.">
          {domains.map((d)=><Row key={d.id} title={d.name} checked={domainId===d.id} onPress={busy ? undefined : ()=>setDomainId(d.id)} />)}
        </Section>
        {!domains.length ? <View style={styles.fieldWrap}><ErrorText>Finish Email setup for a domain before creating a work address.</ErrorText></View> : null}
      </> : <>
      <Section title="Access to" footer="Give access to one mailbox, such as hello@, or to the whole workspace.">
        <Row title="Whole workspace" checked={scope === 'workspace'} onPress={() => setScope('workspace')} />
        {mailboxes.filter((m)=>!m.deleting_at&&(m.shared||!m.owner_user_id)).map((m) => (
          <Row key={m.id} title={m.address} checked={scope === m.id} onPress={() => setScope(m.id)} />
        ))}
      </Section>

      <Section title="Role">
        {offered.map((r) => (
          <Row key={r.id} title={r.title} subtitle={r.description} checked={role === r.id} onPress={() => setRole(r.id)} />
        ))}
      </Section>

      </>}
      <View style={styles.actions}>
        <ErrorText>{error}</ErrorText>
        <SwitchRow title="Email the invite" subtitle="Sends a branded invitation from your default workspace address to their personal email." value={emailInvite} onValueChange={setEmailInvite} />
        <Button variant="brand" title={emailInvite ? 'Create and email invite' : 'Create invite link'} onPress={send} loading={busy} disabled={!email.trim() || (createsAddress ? !localPart.trim() || !domainId : offered.length === 0)} />
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
