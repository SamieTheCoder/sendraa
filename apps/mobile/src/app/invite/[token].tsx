import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { api, ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { rememberCurrentSession } from '@/lib/account-sessions';
import { loadMe, setActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

type Preview = { workAddress: string | null; workspace: string; email: string; loginEmail?: string; separateAccount?: boolean; role: string; expiresAt: string; hasAccount: boolean };

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
  const [createdWorkAccount, setCreatedWorkAccount] = useState<{email:string;workspaceId:string} | null>(null);

  useEffect(() => {
    api<Preview>(`/v1/invites/${encodeURIComponent(token ?? '')}`)
      .then(setPreview)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'This invite cannot be opened.'));
  }, [token]);

  const signedInAsInvitee = Boolean(session && preview && session.user.email.toLowerCase() === preview.email.toLowerCase());

  const goToSignIn = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (session) {
        await rememberCurrentSession();
      }
      router.push({ pathname: '/sign-in', params: { invite: token, email: preview.loginEmail ?? preview.email, ...(session ? { add: '1', from: session.session.id } : {}) } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open sign-in.');
    } finally { setBusy(false); }
  };

  const accept = async () => {
    if (!preview || busy) return;
    if (!preview.hasAccount && !createdWorkAccount && (!name.trim() || password.length < 10)) {
      setError('Enter your name and a password of at least 10 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (session) await rememberCurrentSession();
      let workspaceId: string | undefined;
      if (preview.separateAccount) {
        let account = createdWorkAccount;
        if (!account) {
          const result = await api<{loginEmail:string;workspaceId:string}>('/v1/invites/accept',{method:'POST',body:{token,name:name.trim(),password}});
          account = {email:result.loginEmail,workspaceId:result.workspaceId};
          setCreatedWorkAccount(account);
        }
        // Better Auth stores the new session in Keychain/Keystore on native.
        const result = await authClient.signIn.email({email:account.email,password});
        if(result.error) throw new Error(`Your work account is created. ${result.error.message ?? 'Sign in with your work email and the password you chose.'}`);
        workspaceId=account.workspaceId;
      } else if (preview.hasAccount || signedInAsInvitee) {
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
      if(workspaceId) setActiveWorkspace(workspaceId);
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
              {preview.separateAccount ? 'Create your work account and choose its password. Your personal Sendraa account stays separate.' : `You have been invited as ${preview.role}. Sign in with ${preview.email}.`}
            </Text>

            {preview.workAddress ? <View style={{padding:18,borderRadius:12,backgroundColor:c.cell,gap:6}}>
              <Text style={{color:c.secondaryLabel}}>Your work email</Text>
              <Text selectable style={{color:c.label,fontSize:20,fontWeight:'600'}}>{preview.workAddress}</Text>
            </View> : null}
            {preview.separateAccount ? <Text style={[styles.body,{color:c.secondaryLabel}]}>The invitation was sent to {preview.email}. This address is used for account recovery, not for signing in to your work mailbox.</Text> : null}
            {preview.hasAccount ? (
              signedInAsInvitee ? (
                <Button variant="brand" title={`Join ${preview.workspace}`} onPress={accept} loading={busy} />
              ) : (
                <>
                  <Text style={[styles.body, { color: c.secondaryLabel }]}>
                    {session
                      ? `You are signed in as ${session.user.email}. Switch to ${preview.email} to accept this invitation.`
                      : `${preview.email} has an existing Sendraa login. Sign in to continue with this invitation. Deleting a mailbox does not delete that login.`}
                  </Text>
                  <Button variant="plain" title={session ? 'Switch account' : 'Sign in to continue'} onPress={goToSignIn} loading={busy} />
                </>
              )
            ) : (
              <>
                <Field label="Your name" value={name} onChangeText={setName} textContentType="name" autoComplete="name" returnKeyType="next" editable={!busy && !createdWorkAccount} />
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
                  editable={!busy}
                />
                <ErrorText>{error}</ErrorText>
                <Button variant="brand" title={createdWorkAccount ? 'Sign in to work mailbox' : preview.separateAccount ? 'Create work account' : 'Create account and join'} onPress={accept} loading={busy} />
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
