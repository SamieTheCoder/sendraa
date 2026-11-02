import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { api, ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { loadMe } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

type Preview = { workspace: string; email: string; role: string; expiresAt: string; hasAccount: boolean };

export default function AcceptInvite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const c = useColors();
  const { data: session } = authClient.useSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Preview>(`/v1/invites/${encodeURIComponent(token ?? '')}`)
      .then(setPreview)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'This invite cannot be opened.'));
  }, [token]);

  const signedInAsInvitee = Boolean(session && preview && session.user.email.toLowerCase() === preview.email.toLowerCase());

  const accept = async () => {
    if (!preview) return;
    if (!preview.hasAccount && (!name.trim() || password.length < 10)) {
      setError('Enter your name and a password of at least 10 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (preview.hasAccount) {
        await api('/v1/invites/accept', { method: 'POST', body: { token } });
      } else {
        // Account creation goes through Better Auth so the session cookie is stored securely.
        const { error: err } = await authClient.signUp.email(
          { email: preview.email, password, name: name.trim() },
          { headers: { 'x-sendraa-invite': token ?? '' } },
        );
        if (err) throw new Error(err.message ?? 'Could not create your account.');
        await api('/v1/invites/accept', { method: 'POST', body: { token } });
      }
      const fresh = await authClient.getSession();
      if (fresh.data?.user.id) await loadMe(fresh.data.user.id);
      router.replace('/mail');
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not accept the invite.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.groupedBackground }}>
      <Stack.Screen options={{ title: 'Invitation', headerShown: true }} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.wrap} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        {loadError ? (
          <View style={styles.block}>
            <Text style={[styles.title, { color: c.label }]}>This invite cannot be used</Text>
            <Text style={[styles.body, { color: c.secondaryLabel }]}>{loadError}</Text>
            <Button variant="plain" title="Go to sign in" onPress={() => router.replace('/sign-in')} />
          </View>
        ) : !preview ? (
          <ActivityIndicator style={{ marginTop: 48 }} />
        ) : (
          <View style={styles.block}>
            <Text style={[styles.title, { color: c.label }]} accessibilityRole="header">
              Join {preview.workspace}
            </Text>
            <Text style={[styles.body, { color: c.secondaryLabel }]}>
              You have been invited as {preview.role}. Your address is {preview.email}.
            </Text>

            {preview.hasAccount ? (
              signedInAsInvitee ? (
                <Button variant="brand" title={`Join ${preview.workspace}`} onPress={accept} loading={busy} />
              ) : (
                <>
                  <Text style={[styles.body, { color: c.secondaryLabel }]}>
                    {session
                      ? `You are signed in as ${session.user.email}. Sign out, then sign in as ${preview.email} and open this link again.`
                      : `${preview.email} already has a Sendraa account. Sign in, then open this link again.`}
                  </Text>
                  <Button variant="plain" title={session ? 'Sign out' : 'Go to sign in'} onPress={() => (session ? authClient.signOut() : router.replace('/sign-in'))} />
                </>
              )
            ) : (
              <>
                <Field label="Your name" value={name} onChangeText={setName} textContentType="name" autoComplete="name" returnKeyType="next" />
                <Field
                  label="Choose a password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
                  placeholder="At least 10 characters"
                  returnKeyType="go"
                  onSubmitEditing={accept}
                />
                <ErrorText>{error}</ErrorText>
                <Button variant="brand" title="Create account and join" onPress={accept} loading={busy} />
              </>
            )}
            {preview.hasAccount ? <ErrorText>{error}</ErrorText> : null}
            <Text style={[styles.note, { color: c.tertiaryLabel }]}>
              This link works once and expires {new Date(preview.expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.
            </Text>
          </View>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20 },
  block: { gap: 14 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontSize: 16, lineHeight: 22 },
  note: { fontSize: 13, lineHeight: 18 },
});
