import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthBackdrop, WelcomeFlow } from '@/components/welcome-flow';
import { mailStorage } from '@/mail/persistence';
import { CloudflareButton } from '@/components/cloudflare-button';
import { Button, ErrorText, Field } from '@/components/form';
import { Icon } from '@/components/icon';
import { Mark } from '@/components/logo';
import { KeyboardAwareScrollView, useKeyboardState } from 'react-native-keyboard-controller';
import { API_URL, authClient, authReturnURL } from '@/lib/auth-client';
import { authError, useAuthCooldown } from '@/lib/auth-feedback';
import { passkeysSupported, signInWithPasskey } from '@/lib/passkeys';
import { Brand, useColors } from '@/theme/colors';

type Providers = { cloudflare: boolean; password: boolean; devSignup?: boolean; recovery?: boolean; passkey?: { ios: boolean; android: boolean } };
export default function SignIn() {
  const c = useColors();
  const params = useLocalSearchParams<{ error?: string }>();
  const [introduced, setIntroduced] = useState(() => {
    try { return Boolean(params.error) || mailStorage.getItemSync('sendraa.introduction.v1') === 'done'; } catch { return false; }
  });
  const finishIntroduction = () => {
    try { mailStorage.setItemSync('sendraa.introduction.v1', 'done'); } catch { /* Sign-in still works if local storage is unavailable. */ }
    setIntroduced(true);
  };
  const [providers, setProviders] = useState<Providers | null>(null);
  const [providerError, setProviderError] = useState(false);
  const [panel, setPanel] = useState<'email' | 'dev'>('email');
  const [focusedField, setFocusedField] = useState<'name' | 'email' | 'password'>('email');
  const [passwordHeight, setPasswordHeight] = useState(80);
  const [actionsHeight, setActionsHeight] = useState(108);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(params.error ? 'Cloudflare sign-in did not finish. Try again or use your email and password.' : null);
  const [passkeyReady, setPasskeyReady] = useState(false);
  const cooldown = useAuthCooldown();
  const loadProviders = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/auth/providers`);
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json() as Providers;
      setProviderError(false);
      setProviders(data);
      const enabled = Platform.OS === 'ios' ? data.passkey?.ios : Platform.OS === 'android' ? data.passkey?.android : false;
      setPasskeyReady(Boolean(enabled && await passkeysSupported()));
    } catch { setProviderError(true); }
  }, []);
  // All state updates happen after the network response, never synchronously.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadProviders(); }, [loadProviders]);

  const run = async (kind: string, task: () => Promise<void>) => {
    if (pending.current || cooldown) return;
    pending.current = true; setBusy(kind); setError(null);
    try { await task(); } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in did not finish. Please try again.'); }
    finally { pending.current = false; setBusy(null); }
  };
  const cloudflare = () => run('cloudflare', async () => {
    const result = await authClient.signIn.social({ provider: 'cloudflare' as never, callbackURL: authReturnURL('/'), errorCallbackURL: authReturnURL('/sign-in') });
    if (result.error) throw new Error(authError(result.error));
    const session = await authClient.getSession();
    if (!session.data) setError('Sign-in was cancelled or did not finish. Your account has not changed.');
  });
  const signIn = () => run('email', async () => {
    if (!email.trim() || !password) throw new Error('Enter your email and password.');
    const result = panel === 'dev'
      ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
      : await authClient.signIn.email({ email: email.trim(), password });
    if (result.error) throw new Error(authError(result.error));
  });
  const disabled = busy !== null || cooldown > 0;
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const cloudflareReady = providers?.cloudflare === true;
  const showDev = providers !== null && !cloudflareReady && providers.devSignup === true;
  const open = (next: 'dev') => { setError(null); setPanel(p => p === next ? 'email' : next); };
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardState((state) => state.height);
  const followingFieldsHeight = focusedField === 'password' ? 0 : (passwordHeight + 14) * (focusedField === 'name' ? 2 : 1);
  // On small screens or with large accessibility text, keep the active field visible first.
  const keyboardClearance = Math.min(24 + actionsHeight + followingFieldsHeight, Math.max(24, screenHeight - insets.top - keyboardHeight - passwordHeight - 24));
  const title = panel === 'dev' ? 'Create an account' : 'Welcome back';
  const subtitle = panel === 'dev' ? 'A local account for development.' : 'Sign in to your Sendraa workspace.';
  if (!introduced) return <WelcomeFlow onFinish={finishIntroduction} />;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AuthBackdrop />
      {/* Reserve the measured controls below the focused field, not just the caret.
          Keyboard Controller supplies the actual keyboard height, including autofill. */}
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        bottomOffset={keyboardClearance}
        extraKeyboardSpace={16}
        automaticallyAdjustKeyboardInsets={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.column}>
          <View style={styles.head}>
            <View style={[styles.tile, { backgroundColor: Brand.yellow }]}><Mark size={26} color={Brand.ink} /></View>
            <Text accessibilityRole="header" style={[styles.title, { color: c.label }]}>{title}</Text>
            <Text style={[styles.subtitle, { color: c.secondaryLabel }]}>{subtitle}</Text>
          </View>

          {panel !== 'dev' && cloudflareReady ? (
            <>
              <CloudflareButton onPress={cloudflare} loading={busy === 'cloudflare'} disabled={disabled} />
              <View style={styles.or} accessible={false}>
                <View style={[styles.rule, { backgroundColor: c.separator }]} />
                <Text style={[styles.orText, { color: c.secondaryLabel }]}>or</Text>
                <View style={[styles.rule, { backgroundColor: c.separator }]} />
              </View>
            </>
          ) : panel !== 'dev' && !providers && !providerError ? (
            // Holds the Cloudflare button's place while sign-in options load, so nothing jumps.
            <View style={[styles.placeholder, { backgroundColor: c.fill }]} accessible accessibilityLabel="Checking sign-in options">
              <ActivityIndicator color={c.secondaryLabel as string} />
            </View>
          ) : null}
          {providerError ? (
            <View style={styles.retry}>
              <View style={{ flex: 1 }}><ErrorText>Couldn’t load sign-in options.</ErrorText></View>
              <Button title="Retry" variant="plain" size="compact" onPress={loadProviders} />
            </View>
          ) : null}

          <View style={styles.fields}>
            {panel === 'dev' ? <Field label="Name" onFocus={() => setFocusedField('name')} placeholder="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} /> : null}
            <EmailFields email={email} setEmail={setEmail} password={password} setPassword={setPassword} emailRef={emailRef} passwordRef={passwordRef} onSubmit={signIn} newPassword={panel === 'dev'} onFieldFocus={setFocusedField} onPasswordHeight={setPasswordHeight} />
          </View>
          <View onLayout={(event) => setActionsHeight(event.nativeEvent.layout.height)}>
            {panel !== 'dev' ? <Link href="/forgot-password" style={[styles.forgot, { color: c.tint }]}>Forgot password?</Link> : null}

            <View style={styles.actions}>
              <ErrorText>{error}</ErrorText>
              {cooldown > 0 ? <Text accessibilityLiveRegion="polite" style={[styles.small, { color: c.secondaryLabel, fontVariant: ['tabular-nums'] }]}>Too many attempts. Try again in {cooldown}s.</Text> : null}
              <Button variant="brand" title={panel === 'dev' ? 'Create account' : 'Sign in'} onPress={signIn} loading={busy === 'email'} disabled={disabled} />
              {passkeyReady && panel !== 'dev' ? (
                <Button
                  title="Use a passkey"
                  variant="plain"
                  size="compact"
                  onPress={() => run('passkey', signInWithPasskey)}
                  disabled={disabled}
                  loading={busy === 'passkey'}
                  leading={<Icon ios="person.badge.key" android="passkey" size={18} color={c.tint} />}
                />
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.column, styles.foot]}>
          {showDev ? (
            <Text style={[styles.small, { color: c.secondaryLabel }]}>
              {panel === 'dev' ? 'Have an account? ' : 'New here? '}
              <Text onPress={() => open('dev')} accessibilityRole="link" style={[styles.footLink, { color: c.tint }]}>{panel === 'dev' ? 'Sign in' : 'Create an account'}</Text>
            </Text>
          ) : null}
          <Text style={[styles.legal, { color: c.tertiaryLabel }]}>
            By continuing you agree to the{' '}
            <Link href={{ pathname: '/legal', params: { document: 'terms' } }} style={{ color: c.secondaryLabel, fontWeight: '600' }}>Terms</Link>
            {' '}and{' '}
            <Link href={{ pathname: '/legal', params: { document: 'privacy' } }} style={{ color: c.secondaryLabel, fontWeight: '600' }}>Privacy Policy</Link>.
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

function EmailFields({ email, setEmail, password, setPassword, emailRef, passwordRef, onSubmit, newPassword, onFieldFocus, onPasswordHeight }: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  emailRef: React.RefObject<ComponentRef<typeof TextInput> | null>;
  passwordRef: React.RefObject<ComponentRef<typeof TextInput> | null>;
  onSubmit: () => void;
  newPassword: boolean;
  onFieldFocus: (field: 'email' | 'password') => void;
  onPasswordHeight: (height: number) => void;
}) {
  return (
    <>
      <Field
        ref={emailRef}
        label="Email"
        onFocus={() => onFieldFocus('email')}
        submitBehavior="submit"
        placeholder="you@company.com"
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
      <View onLayout={(event) => onPasswordHeight(event.nativeEvent.layout.height)}>
        <Field
          ref={passwordRef}
          label="Password"
          onFocus={() => onFieldFocus('password')}
          placeholder={newPassword ? 'At least 10 characters' : 'Your password'}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType={newPassword ? 'newPassword' : 'password'}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, gap: 24 },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center', paddingHorizontal: 24 },
  head: { alignItems: 'center', paddingTop: 16, paddingBottom: 24 },
  tile: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6, textAlign: 'center' },
  subtitle: { fontSize: 16, lineHeight: 22, marginTop: 6, textAlign: 'center' },
  placeholder: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  or: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { fontSize: 14 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  fields: { gap: 14 },
  forgot: { alignSelf: 'flex-end', fontSize: 15, fontWeight: '600', paddingVertical: 10 },
  actions: { gap: 10, marginTop: 6 },
  small: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  foot: { gap: 10, marginTop: 'auto', paddingTop: 8 },
  footLink: { fontWeight: '600' },
  legal: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
