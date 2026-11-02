import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, ErrorText, Field } from '@/components/form';
import { authClient } from '@/lib/auth-client';
import { authError, useAuthCooldown } from '@/lib/auth-feedback';
import { useColors } from '@/theme/colors';

export default function ForgotPassword() {
  const c = useColors();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useAuthCooldown();
  const submit = async () => {
    if (busy || cooldown) return;
    if (!email.trim().includes('@')) return setError('Enter your sign-in email or admin mailbox address.');
    setBusy(true); setError(null);
    try {
      const result = await authClient.requestPasswordReset({ email: email.trim() });
      if (result.error) throw new Error(result.error.status === 400 ? 'Password recovery is not available on this server yet. You can still sign in with Cloudflare.' : authError(result.error));
      setSent(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not request a reset. Try again.'); }
    finally { setBusy(false); }
  };
  return <KeyboardAwareScrollView bottomOffset={24} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 20, maxWidth: 480, width: '100%', alignSelf: 'center' }} style={{ backgroundColor: c.groupedBackground }}>
    <Stack.Screen options={{ title: 'Reset password' }} />
    <Text style={{ color: c.label, fontSize: 24, fontWeight: '600' }}>{sent ? 'Check your recovery inbox' : 'Let’s get you back in.'}</Text>
    <Text style={{ color: c.secondaryLabel, fontSize: 16, lineHeight: 24 }}>{sent ? 'If this account can be recovered, we’ve sent a reset link to its verified recovery address, or its verified sign-in email. The link expires in 15 minutes. Check your spam folder too.' : 'Enter the email you use to sign in. We’ll send a link to your verified recovery address. Your Cloudflare sign-in will still work.'}</Text>
    {!sent ? <View style={{ gap: 14 }}>
      <Field label="Sign-in email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" autoCorrect={false} returnKeyType="send" onSubmitEditing={submit} />
      <Button title={cooldown ? `Try again in ${cooldown}s` : 'Send reset link'} variant="brand" onPress={submit} loading={busy} disabled={busy || cooldown > 0} />
    </View> : <Button title="Use another email" variant="plain" onPress={() => { setSent(false); setError(null); }} />}
    <ErrorText>{error}</ErrorText>
  </KeyboardAwareScrollView>;
}
