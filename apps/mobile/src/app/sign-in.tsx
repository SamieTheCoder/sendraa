import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorText, Field } from '@/components/form';
import { Lockup } from '@/components/logo';
import { API_URL, authClient } from '@/lib/auth-client';
import { useColors } from '@/theme/colors';

type Providers = { cloudflare: boolean; password: boolean; devSignup?: boolean };
type Panel = 'none' | 'member' | 'dev';

/**
 * Admins (the people who own the domain and the Cloudflare account) come in
 * with Cloudflare, which also creates their Sendraa account the first time.
 * Team members never sign up here; they set a password from an invite link,
 * then use the email form below.
 */
export default function SignIn() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'cloudflare' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    fetch(`${API_URL}/v1/auth/providers`)
      .then((r) => r.json() as Promise<Providers>)
      .then(setProviders)
      .catch(() => setError(`Cannot reach Sendraa at ${API_URL}. Check your connection.`));
  }, []);

  const open = (next: Panel) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setError(null);
    setPanel((p) => (p === next ? 'none' : next));
  };

  const withCloudflare = async () => {
    setBusy('cloudflare');
    setError(null);
    // Opens Cloudflare's consent screen in the system browser. The API keeps
    // the Cloudflare tokens; the app only gets a Sendraa session back.
    const { error: err } = await authClient.signIn.social({ provider: 'cloudflare' as never, callbackURL: '/' });
    setBusy(null);
    if (!err) return;
    if (/access_denied|no.*account/i.test(err.message ?? '')) {
      setError('Cloudflare did not share an account with Sendraa. If your organisation turned off third-party app access, ask a Cloudflare Super Administrator to allow it.');
    } else {
      setError(err.message ?? 'Cloudflare sign-in did not finish. Try again.');
    }
  };

  const withEmail = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy('email');
    setError(null);
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(null);
    if (err) setError(err.status === 401 ? 'That email and password do not match.' : (err.message ?? 'Sign-in failed. Try again.'));
  };

  const createDevAdmin = async () => {
    if (!name.trim() || !email.trim() || password.length < 10) return setError('Enter a name, an email and a password of at least 10 characters.');
    setBusy('email');
    setError(null);
    const { error: err } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
    setBusy(null);
    if (err) setError(err.message ?? 'Could not create the account.');
  };

  const cloudflareReady = providers?.cloudflare === true;
  const showDev = providers !== null && !cloudflareReady && providers.devSignup === true;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.hero}>
          <Lockup size={46} />
          <Text style={[styles.tagline, { color: c.secondaryLabel }]}>Professional email on your own domain.</Text>
        </View>

        <View style={styles.primary}>
          {cloudflareReady ? (
            <Button variant="brand" title="Continue with Cloudflare" onPress={withCloudflare} loading={busy === 'cloudflare'} disabled={busy !== null} />
          ) : (
            <View style={[styles.notice, { backgroundColor: c.cell }]}>
              <Text style={[styles.noticeTitle, { color: c.label }]}>{providers ? 'Cloudflare sign-in is not connected yet' : 'Checking sign-in options…'}</Text>
              {providers ? (
                <Text style={[styles.note, { color: c.secondaryLabel }]}>
                  This server has no Cloudflare OAuth client. Once one is added, this becomes a single “Continue with Cloudflare” button.
                </Text>
              ) : null}
            </View>
          )}
          <Text style={[styles.caption, { color: c.secondaryLabel }]}>
            New to Sendraa? This creates your account. Mail is stored in your own Cloudflare account, and receiving is free.
          </Text>
        </View>

        {panel === 'none' ? <ErrorText>{error}</ErrorText> : null}

        <View style={styles.secondary}>
          <Disclosure title="Team member? Sign in with email" open={panel === 'member'} onPress={() => open('member')} />
          {panel === 'member' ? (
            <View style={styles.form}>
              <EmailFields email={email} setEmail={setEmail} password={password} setPassword={setPassword} emailRef={emailRef} passwordRef={passwordRef} onSubmit={withEmail} newPassword={false} />
              <ErrorText>{error}</ErrorText>
              <Button title="Sign in" onPress={withEmail} loading={busy === 'email'} disabled={busy !== null} />
              <Text style={[styles.caption, { color: c.tertiaryLabel }]}>
                No password yet? Open the invite link your admin sent you. That is where you set it.
              </Text>
            </View>
          ) : null}

          {showDev ? (
            <>
              <Disclosure title="Development: create an admin without Cloudflare" open={panel === 'dev'} onPress={() => open('dev')} />
              {panel === 'dev' ? (
                <View style={styles.form}>
                  <Field label="Name" value={name} onChangeText={setName} textContentType="name" autoComplete="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />
                  <EmailFields email={email} setEmail={setEmail} password={password} setPassword={setPassword} emailRef={emailRef} passwordRef={passwordRef} onSubmit={createDevAdmin} newPassword />
                  <ErrorText>{error}</ErrorText>
                  <Button title="Create admin" onPress={createDevAdmin} loading={busy === 'email'} disabled={busy !== null} />
                  <Text style={[styles.caption, { color: c.tertiaryLabel }]}>
                    Only offered because this server runs with ALLOW_DEV_ADMIN_SIGNUP. Production servers refuse it.
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Disclosure({ title, open, onPress }: { title: string; open: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.55 : 1 }]}
    >
      <Text style={[styles.disclosureText, { color: c.tint }]}>{title}</Text>
      <Text style={[styles.chevron, { color: c.tint, transform: [{ rotate: open ? '90deg' : '0deg' }] }]}>›</Text>
    </Pressable>
  );
}

function EmailFields(props: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  emailRef: React.RefObject<ComponentRef<typeof TextInput> | null>;
  passwordRef: React.RefObject<ComponentRef<typeof TextInput> | null>;
  onSubmit: () => void;
  newPassword: boolean;
}) {
  return (
    <>
      <Field
        ref={props.emailRef}
        label="Email"
        value={props.email}
        onChangeText={props.setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        returnKeyType="next"
        onSubmitEditing={() => props.passwordRef.current?.focus()}
      />
      <Field
        ref={props.passwordRef}
        label="Password"
        value={props.password}
        onChangeText={props.setPassword}
        secureTextEntry
        textContentType={props.newPassword ? 'newPassword' : 'password'}
        autoComplete={props.newPassword ? 'new-password' : 'current-password'}
        returnKeyType="go"
        onSubmitEditing={props.onSubmit}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 28, flexGrow: 1 },
  hero: { alignItems: 'center', gap: 12, marginBottom: 8 },
  tagline: { fontSize: 17, lineHeight: 22, textAlign: 'center' },
  primary: { gap: 12 },
  notice: { borderRadius: 14, padding: 16, gap: 6 },
  noticeTitle: { fontSize: 15, fontWeight: '600' },
  note: { fontSize: 14, lineHeight: 19 },
  caption: { fontSize: 13, lineHeight: 18, marginHorizontal: 4, textAlign: 'center' },
  secondary: { gap: 6, marginTop: 'auto' },
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
  disclosureText: { fontSize: 15, fontWeight: '500' },
  chevron: { fontSize: 20, lineHeight: 22, fontWeight: '500' },
  form: { gap: 10, paddingTop: 4, paddingBottom: 8 },
});
