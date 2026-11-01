import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorText, Field } from '@/components/form';
import { Icon } from '@/components/icon';
import { API_URL, authClient } from '@/lib/auth-client';
import { Brand, useColors } from '@/theme/colors';

export default function SignIn() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [providers, setProviders] = useState<{ cloudflare: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'cloudflare' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    fetch(`${API_URL}/v1/auth/providers`)
      .then((r) => r.json())
      .then(setProviders)
      .catch(() => setError(`Cannot reach Sendraa at ${API_URL}. Check your connection.`));
  }, []);

  const withCloudflare = async () => {
    setBusy('cloudflare');
    setError(null);
    // Opens Cloudflare's consent screen in the system browser and returns with a session.
    const { error: err } = await authClient.signIn.social({ provider: 'cloudflare' as never, callbackURL: '/' });
    setBusy(null);
    if (err) setError(err.message ?? 'Cloudflare sign-in did not finish. Try again.');
  };

  const withEmail = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy('email');
    setError(null);
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(null);
    if (err) setError(err.status === 401 ? 'That email and password do not match.' : (err.message ?? 'Sign-in failed. Try again.'));
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.tile} accessibilityElementsHidden importantForAccessibility="no">
            <Icon ios="paperplane.fill" android="send" size={34} color={Brand.ink} />
          </View>
          <Text style={[styles.wordmark, { color: c.label }]} accessibilityRole="header">
            sendraa
          </Text>
          <Text style={[styles.tagline, { color: c.secondaryLabel }]}>Professional email on your own domain.</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: c.secondaryLabel }]}>Workspace admins</Text>
          {providers?.cloudflare ? (
            <Button variant="brand" title="Continue with Cloudflare" onPress={withCloudflare} loading={busy === 'cloudflare'} disabled={busy !== null} />
          ) : (
            <Text style={[styles.note, { color: c.secondaryLabel }]}>
              {providers ? 'Cloudflare sign-in is not set up on this server yet.' : 'Checking sign-in options…'}
            </Text>
          )}
          <Text style={[styles.note, { color: c.tertiaryLabel }]}>Your mail runs in your own Cloudflare account. Receiving mail is free.</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: c.secondaryLabel }]}>Team members</Text>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Field
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={withEmail}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Sign in" onPress={withEmail} loading={busy === 'email'} disabled={busy !== null} />
          <Text style={[styles.note, { color: c.tertiaryLabel }]}>New to a team? Open the invite link your admin sent you to set your password.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 32 },
  hero: { alignItems: 'center', gap: 10 },
  tile: { width: 72, height: 72, borderRadius: 18, backgroundColor: Brand.lime, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  wordmark: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
  tagline: { fontSize: 17, textAlign: 'center' },
  section: { gap: 10 },
  heading: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 4 },
  note: { fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
});
