import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { AddressStrip } from '@/components/address-strip';
import { Avatar } from '@/components/avatar';
import { Button, ErrorText, Field, NoticeText } from '@/components/form';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { API_URL, authClient } from '@/lib/auth-client';
import { authError, useAuthCooldown } from '@/lib/auth-feedback';
import { addPasskey, deletePasskey, listPasskeys, passkeyAvailability, type PasskeyRecord } from '@/lib/passkeys';
import { getMe, useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

type Security = { email: string; aliases: string[]; hasPassword: boolean; recoveryEmail: string | null; pendingEmail: string | null; recoveryAvailable: boolean };
export default function AccountSecurity() {
  const c = useColors();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const [account, setAccount] = useState<Security | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);
  const [passkeyReason, setPasskeyReason] = useState('Checking passkey availability…');
  const [editing, setEditing] = useState<'password' | 'recovery' | null>(onboarding ? 'password' : null);
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const cooldown = useAuthCooldown();
  const refresh = useCallback(async () => {
    const data = await api<Security>('/v1/security/account');
    setAccount(data);
    const response = await fetch(`${API_URL}/v1/auth/providers`).catch(() => null);
    if (response?.ok) {
      const providers = await response.json();
      const availability = await passkeyAvailability(Boolean(providers.passkey?.[Platform.OS]));
      setCanPasskey(availability.available);
      setPasskeyReason(availability.reason ?? '');
      if (availability.available) setPasskeys(await listPasskeys());
    } else {
      setCanPasskey(false);
      setPasskeyReason('Could not check passkey availability. Try again when your connection is restored.');
    }
  }, []);
  // State is updated only after the awaited server response.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh().catch((err) => setError(err.message)); }, [refresh]);
  const save = async (kind: string, task: () => Promise<void>, message: string) => {
    if (busy || cooldown) return;
    setBusy(kind); setError(null); setNotice(null);
    try { await task(); setNotice(message); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save. Your changes are still here.'); }
    finally { setBusy(null); }
  };
  const savePassword = () => save('password', async () => {
    if (password.length < 10 || password.length > 128) throw new Error('Use between 10 and 128 characters.');
    if (password !== confirm) throw new Error('The new passwords do not match.');
    if (account?.hasPassword) {
      const result = await authClient.changePassword({ currentPassword: current, newPassword: password, revokeOtherSessions: true });
      if (result.error) throw new Error(authError(result.error));
    } else await api('/v1/security/password', { method: 'POST', body: { newPassword: password } });
    setPassword(''); setConfirm(''); setCurrent(''); setEditing(null);
  }, 'Password saved. You can now sign in with your email.');
  const disabled = busy !== null || cooldown > 0;
  const me = getMe();
  const workspace = useActiveWorkspace();
  const cloudflare = Boolean(me?.signedInWithCloudflare || workspace?.linkedToCloudflare);
  const toggle = (next: 'password' | 'recovery') => {
    setEditing(editing === next ? null : next);
    setPassword(''); setConfirm(''); setCurrent(''); setError(null); setNotice(null);
  };
  const ways = account ? [cloudflare, account.hasPassword, passkeys.length > 0].filter(Boolean).length : 0;

  return <KeyboardAwareScrollView bottomOffset={24} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} style={{ backgroundColor: c.groupedBackground }}>
    <Stack.Screen options={{ title: onboarding ? 'Secure your account' : 'Account and security' }} />
    {!account ? (
      <View style={styles.loading}>
        {error ? <><ErrorText>{error}</ErrorText><Button title="Try again" variant="outline" size="compact" onPress={() => refresh().catch((err) => setError(err.message))} /></> : <ActivityIndicator color={c.secondaryLabel as string} />}
      </View>
    ) : <>
      {/* Identity: who is signed in, and how protected the account is. */}
      <View style={styles.identity}>
        {onboarding ? <Text accessibilityRole="header" style={[styles.title, { color: c.label }]}>Your inbox is ready.</Text> : null}
        <View style={styles.identityRow}>
          <Avatar name={me?.user.name || account.email} address={account.email} size={52} />
          <View style={styles.identityText}>
            <Text style={[styles.name, { color: c.label }]} numberOfLines={1}>{me?.user.name || 'Your account'}</Text>
            <AddressStrip address={account.email} ground={c.groupedBackground} />
          </View>
        </View>
        {account.aliases.length ? <Text selectable style={[styles.body, { color: c.secondaryLabel }]}>Also receives mail at {account.aliases.join(', ')}</Text> : null}
        <Text style={[styles.body, { color: c.secondaryLabel }]}>
          {onboarding
            ? 'Add a password or passkey so you can open your mail without signing in to Cloudflare each time.'
            : ways >= 2 ? `You have ${ways} ways to sign in. If you lose one, you can still get in.` : 'Add a second way to sign in, so losing one does not lock you out.'}
        </Text>
      </View>

      <NoticeText>{notice}</NoticeText>
      <ErrorText>{error}</ErrorText>
      {cooldown ? <Text style={[styles.body, { color: c.secondaryLabel, fontVariant: ['tabular-nums'] }]}>Too many attempts. Try again in {cooldown}s.</Text> : null}

      <Text accessibilityRole="header" style={[styles.groupTitle, { color: c.label }]}>Ways to sign in</Text>

      <Method
        icon={<Image source={require('../../assets/images/cloudflare.svg')} style={styles.cloud} contentFit="contain" accessible={false} />}
        title="Cloudflare"
        status={cloudflare ? { label: 'Connected', tone: 'good' } : { label: 'Not used', tone: 'none' }}
        description={cloudflare ? 'Your workspace is linked to its Cloudflare account. Owners can always sign in this way.' : 'Owners sign in with the Cloudflare account that holds the domain.'}
      />

      <Method
        icon={<Icon ios="key" android="key" size={18} color={c.label} />}
        title="Password"
        status={account.hasPassword ? { label: 'Set', tone: 'good' } : { label: 'Not set', tone: 'none' }}
        description={account.hasPassword ? 'Signs you in with your email and password.' : 'Add a password for your sign-in email and admin mailbox.'}
        action={<Button size="compact" variant="outline" title={editing === 'password' ? 'Cancel' : account.hasPassword ? 'Change password' : 'Set a password'} disabled={disabled} onPress={() => toggle('password')} />}
      >
        {editing === 'password' ? <View style={styles.form}>
          {account.hasPassword ? <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" /> : null}
          <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" invalid={password.length > 0 && password.length < 10} />
          <Text style={[styles.hint, { color: password.length >= 10 ? c.green : c.secondaryLabel }]}>
            {password.length >= 10 ? 'Long enough.' : '10 to 128 characters. A long passphrase works well.'}
          </Text>
          <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" invalid={confirm.length > 0 && confirm !== password} />
          <Button variant="brand" title="Save password" onPress={savePassword} disabled={disabled} loading={busy === 'password'} />
        </View> : null}
      </Method>

      <Method
        icon={<Icon ios="person.badge.key" android="passkey" size={18} color={c.label} />}
        title="Passkeys"
        status={canPasskey ? passkeys.length ? { label: `${passkeys.length} saved`, tone: 'good' } : { label: 'None yet', tone: 'none' } : { label: 'Unavailable', tone: 'none' }}
        description={canPasskey ? 'Sign in with Face ID, a fingerprint or your screen lock. Your biometrics never leave this device.' : passkeyReason}
        action={canPasskey
          ? <Button size="compact" variant="outline" title="Add a passkey" disabled={disabled} loading={busy === 'passkey'} onPress={() => save('passkey', addPasskey, 'Passkey added.')} />
          : <Button size="compact" variant="outline" title="Check again" disabled={disabled} loading={busy === 'check'} onPress={() => save('check', async () => {}, 'Availability checked.')} />}
      >
        {canPasskey && passkeys.length ? <View style={[styles.list, { borderColor: c.separator }]}>
          {passkeys.map((key) => (
            <View key={key.id} style={[styles.listRow, { borderColor: c.separator }]}>
              <Text style={[styles.listTitle, { color: c.label }]} numberOfLines={1}>{key.name || 'Passkey'}</Text>
              <Button size="compact" variant="plain" destructive title="Remove" disabled={disabled} onPress={() => Alert.alert('Remove this passkey?', 'You can still sign in with Cloudflare or your password.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => save('passkey', async () => { await deletePasskey(key.id); }, 'Passkey removed.') }])} />
            </View>
          ))}
        </View> : null}
      </Method>

      <Text accessibilityRole="header" style={[styles.groupTitle, { color: c.label }]}>Recovery</Text>

      <Method
        icon={<Icon ios="lifepreserver" android="support" size={18} color={c.label} />}
        title="Recovery email"
        status={account.recoveryEmail ? { label: 'Verified', tone: 'good' } : account.pendingEmail ? { label: 'Check your inbox', tone: 'warn' } : account.recoveryAvailable ? { label: 'Not set', tone: 'none' } : { label: 'Unavailable', tone: 'none' }}
        description={account.recoveryAvailable ? 'An address outside Sendraa that can reset your password if you lose access.' : 'Recovery email is not available yet. Cloudflare sign-in still works.'}
        action={account.recoveryAvailable ? <Button size="compact" variant="outline" title={editing === 'recovery' ? 'Cancel' : account.recoveryEmail ? 'Change' : 'Add recovery email'} disabled={disabled} onPress={() => toggle('recovery')} /> : undefined}
      >
        {account.recoveryEmail ? <AddressStrip address={account.recoveryEmail} ground={c.cell} size="small" /> : null}
        {account.recoveryAvailable && editing === 'recovery' ? <View style={styles.form}>
          <Field label="Recovery email" placeholder="you@gmail.com" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" autoCorrect={false} autoCapitalize="none" returnKeyType="send" />
          <Button variant="filled" title={account.pendingEmail ? 'Send a new code' : 'Send verification code'} disabled={disabled || !email.trim()} loading={busy === 'recovery'} onPress={() => save('recovery', async () => { await api('/v1/security/recovery', { method: 'POST', body: { email: email.trim() } }); setCode(''); }, 'Code sent. Enter it below to confirm the address.')} />
        </View> : null}
        {account.recoveryAvailable && account.pendingEmail ? <View style={styles.form}>
          <Text style={[styles.body, { color: c.secondaryLabel }]}>Enter the 8-digit code sent to {account.pendingEmail}. It expires in 15 minutes.</Text>
          <Field label="Verification code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8} style={styles.code} />
          <Button variant="filled" title="Confirm recovery email" disabled={disabled || code.length !== 8} loading={busy === 'verify'} onPress={() => save('verify', async () => { await api('/v1/security/recovery/verify', { method: 'POST', body: { code } }); setCode(''); setEmail(''); setEditing(null); }, 'Recovery email verified.')} />
        </View> : null}
      </Method>

      {onboarding ? <Button variant="ink" title="Continue to inbox" onPress={() => router.replace('/mail')} disabled={disabled} /> : null}
      <Link href={{ pathname: '/legal', params: { document: 'privacy' } }} style={[styles.link, { color: c.tint }]}>How Sendraa protects your information</Link>
    </>}
  </KeyboardAwareScrollView>;
}

type Tone = 'good' | 'warn' | 'none';

/** One way into the account: what it is, whether it is on, and the action that changes it. */
function Method({ icon, title, status, description, action, children }: { icon: ReactNode; title: string; status: { label: string; tone: Tone }; description: string; action?: ReactNode; children?: ReactNode }) {
  const c = useColors();
  const tone = { good: c.green, warn: c.orange, none: c.tertiaryLabel }[status.tone];
  return <View style={[styles.card, { backgroundColor: c.cell }]}>
    <View style={styles.cardHead}>
      <View style={[styles.tile, { backgroundColor: c.fill }]}>{icon}</View>
      <Text accessibilityRole="header" style={[styles.cardTitle, { color: c.label }]}>{title}</Text>
      <View style={styles.status} accessible accessibilityLabel={`Status: ${status.label}`}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={[styles.statusText, { color: status.tone === 'none' ? c.secondaryLabel : c.label }]}>{status.label}</Text>
      </View>
    </View>
    <Text style={[styles.body, { color: c.secondaryLabel }]}>{description}</Text>
    {children}
    {action ? <View style={styles.action}>{action}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  loading: { gap: 14, paddingVertical: 40 },
  identity: { gap: 12, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  identityText: { flex: 1, gap: 6 },
  name: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  groupTitle: { fontSize: 15, fontWeight: '600', marginTop: 14, marginLeft: 4 },
  card: { borderRadius: 16, padding: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cloud: { width: 24, height: 11 },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 14, fontWeight: '500' },
  body: { fontSize: 15, lineHeight: 21 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: -8 },
  action: { flexDirection: 'row', marginTop: 4 },
  form: { gap: 14, marginTop: 6 },
  code: { fontSize: 22, letterSpacing: 6, fontVariant: ['tabular-nums'] },
  list: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  listTitle: { flex: 1, fontSize: 16 },
  link: { fontSize: 15, fontWeight: '600', paddingVertical: 14, marginLeft: 4 },
});
