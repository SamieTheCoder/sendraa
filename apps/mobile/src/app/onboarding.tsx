import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { Icon } from '@/components/icon';
import { ApiError, api } from '@/lib/api';
import { authClient, authReturnURL } from '@/lib/auth-client';
import { getMe, loadMe } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

type CfAccount = { id: string; name: string };
type Zone = { id: string; name: string; status: string };

/** Shown to a signed-in person who is not in any workspace yet. */
export default function Onboarding() {
  const c = useColors();
  const me = getMe();
  const viaCloudflare = Boolean(me?.signedInWithCloudflare);

  const [name, setName] = useState('');
  const [accounts, setAccounts] = useState<CfAccount[] | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown, fallback: string) => {
    setError(err instanceof Error ? err.message : fallback);
    setNeedsReauth(err instanceof ApiError && (err.code === 'CLOUDFLARE_REAUTH' || err.code === 'NO_CLOUDFLARE_ACCOUNT'));
  };

  useEffect(() => {
    if (!viaCloudflare) return;
    api<{ accounts: CfAccount[] }>('/v1/cloudflare/accounts')
      .then(({ accounts: list }) => {
        setAccounts(list);
        if (list.length === 1) setAccountId(list[0]!.id);
      })
      .catch((err) => fail(err, 'Could not read your Cloudflare accounts.'));
  }, [viaCloudflare]);

  useEffect(() => {
    if (!accountId) return;
    let current = true;
    api<{ zones: Zone[] }>(`/v1/cloudflare/zones?accountId=${accountId}`)
      .then(({ zones: list }) => { if (current) setZones(list); })
      .catch((err) => { if (current) fail(err, 'Could not read the domains in that account.'); });
    return () => { current = false; };
  }, [accountId]);

  const create = async () => {
    if (!name.trim()) return setError('Enter a name for your workspace, such as your company name.');
    if (viaCloudflare && !accountId) return setError('Choose the Cloudflare account your mail will run in.');
    setBusy(true);
    setError(null);
    try {
      await api('/v1/tenants', { method: 'POST', body: { name: name.trim(), cloudflareAccountId: accountId ?? undefined } });
      if (me) await loadMe(me.user.id);
      // Straight on to building the mail system in that Cloudflare account.
      if (viaCloudflare) router.replace('/setup');
    } catch (err) {
      fail(err, 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  };

  const reconnect = () => authClient.signIn.social({ provider: 'cloudflare' as never, callbackURL: authReturnURL('/') });

  if (!me?.canCreateWorkspace) {
    return (
      <KeyboardAwareScrollView bottomOffset={24} style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={styles.wrap} contentInsetAdjustmentBehavior="automatic">
        <Stack.Screen options={{ title: 'Welcome', headerShown: true }} />
        <Text style={[styles.title, { color: c.label }]} accessibilityRole="header">
          You are not in a workspace yet
        </Text>
        <Text style={[styles.body, { color: c.secondaryLabel }]}>
          Ask your workspace admin to invite {me?.user.email ?? 'you'}, then open the link in the invite. Admins who want to set up a new workspace sign in with Cloudflare.
        </Text>
        <Button variant="plain" title="Sign out" onPress={() => authClient.signOut()} />
      </KeyboardAwareScrollView>
    );
  }

  const account = accounts?.find((a) => a.id === accountId);

  return (
    <View style={{ flex: 1, backgroundColor: c.groupedBackground }}>
      <Stack.Screen options={{ title: 'Set up Sendraa', headerShown: true }} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.wrap} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <Text style={[styles.body, { color: c.secondaryLabel }]}>
          A workspace holds your domains, mailboxes and team. You will be its owner.
        </Text>

        <Field label="Workspace name" value={name} onChangeText={setName} placeholder="Northwind Labs" returnKeyType="done" autoFocus />

        {viaCloudflare ? (
          <View style={styles.block}>
            <Text style={[styles.heading, { color: c.secondaryLabel }]}>Cloudflare account</Text>
            {accounts === null && !error ? <ActivityIndicator style={styles.spinner} /> : null}
            {accounts && accounts.length > 1 ? (
              <View style={[styles.group, { backgroundColor: c.cell }]}>
                {accounts.map((a, i) => (
                  <Pressable
                    key={a.id}
                    onPress={() => { if (a.id !== accountId) { setZones(null); setError(null); setAccountId(a.id); } }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: a.id === accountId }}
                    style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.rowText, { color: c.label }]} numberOfLines={1}>{a.name}</Text>
                    {a.id === accountId ? <Icon ios="checkmark" android="check" size={17} color={c.tint} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : account ? (
              <View style={[styles.group, styles.row, { backgroundColor: c.cell }]}>
                <Text style={[styles.rowText, { color: c.label }]} numberOfLines={1}>{account.name}</Text>
              </View>
            ) : null}
            <Text style={[styles.caption, { color: c.secondaryLabel }]}>Mail is stored in this Cloudflare account. Sendraa securely retrieves it when you use the app.</Text>

            {accountId ? (
              <>
                <Text style={[styles.heading, { color: c.secondaryLabel, marginTop: 10 }]}>Domains in this account</Text>
                {zones === null ? (
                  <ActivityIndicator style={styles.spinner} />
                ) : zones.length === 0 ? (
                  <Text style={[styles.caption, { color: c.secondaryLabel }]}>No domains yet. Add one to Cloudflare first, or connect it after setup.</Text>
                ) : (
                  <View style={[styles.group, { backgroundColor: c.cell }]}>
                    {zones.map((z, i) => (
                      <View key={z.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }]}>
                        <Text style={[styles.rowText, { color: c.label }]} numberOfLines={1}>{z.name}</Text>
                        {z.status !== 'active' ? <Text style={[styles.badge, { color: c.secondaryLabel }]}>{z.status}</Text> : null}
                      </View>
                    ))}
                  </View>
                )}
                <Text style={[styles.caption, { color: c.secondaryLabel }]}>Next, choose one domain for email. This version supports one connected domain per workspace.</Text>
              </>
            ) : null}
          </View>
        ) : null}

        <ErrorText>{error}</ErrorText>
        {needsReauth ? <Button title="Sign in with Cloudflare again" onPress={reconnect} /> : null}
        <Button variant="brand" title="Create workspace" onPress={create} loading={busy} disabled={viaCloudflare && !accountId} />
        <Button variant="plain" title="Sign out" onPress={() => authClient.signOut()} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 14 },
  block: { gap: 8 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontSize: 16, lineHeight: 22 },
  heading: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 4 },
  group: { borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 46, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { fontSize: 17, flexShrink: 1 },
  badge: { fontSize: 13 },
  caption: { fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
  spinner: { alignSelf: 'flex-start', marginLeft: 6, marginVertical: 8 },
});
