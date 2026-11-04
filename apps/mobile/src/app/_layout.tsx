import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StatusBar, StyleSheet, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Button } from '@/components/form';
import { NotificationObserver } from '@/components/notification-observer';
import { UndoBar } from '@/components/undo-bar';
import { useIdentityScope, signOutCurrentAccount } from '@/lib/account-sessions';
import { authClient } from '@/lib/auth-client';
import { loadMe, useMe } from '@/lib/workspace';
import { useColors, useScheme, useTintHex } from '@/theme/colors';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useScheme();
  const tint = useTintHex();
  const c = useColors();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  // iOS colours are dynamic system colours already; Android needs the palette's plain hex values so
  // navigator-drawn text and surfaces match the screens in both light and dark mode.
  const theme = Platform.OS === 'android'
    ? { ...base, colors: { ...base.colors, primary: tint, background: c.background as string, card: c.background as string, text: c.label as string, border: c.separator as string } }
    : { ...base, colors: { ...base.colors, primary: tint } };

  const { data: session, isPending } = authClient.useSession();
  // better-auth refetches the session whenever the app becomes active, and while signed out that
  // refetch reports isPending again. Password autofill and Face ID briefly make the app inactive,
  // so gating on isPending every time unmounted the sign-in screen and wiped the form.
  // Only the first session check may hold the app on the spinner.
  const [sessionKnown, setSessionKnown] = useState(false);
  if (!isPending && !sessionKnown) setSessionKnown(true);
  const identityReady = useIdentityScope(session?.user.id ?? null);
  const me = useMe(session?.user.id);
  // A font failure falls back to the system face rather than blocking launch.
  const [fontsLoaded, fontError] = useFonts({ LeagueGothic: require('../../assets/fonts/LeagueGothic.ttf') });
  const signedIn = Boolean(session);
  const ready = me.status === 'ready' && me.userId === session?.user.id && identityReady;
  const hasWorkspace = signedIn && ready && me.me.workspaces.length > 0;
  const deciding = !identityReady || (Boolean(session) && "userId" in me && me.userId !== session?.user.id) || !sessionKnown || (!fontsLoaded && !fontError) || (signedIn && (me.status === 'idle' || me.status === 'loading'));

  useEffect(() => {
    if (!deciding) void SplashScreen.hideAsync();
  }, [deciding]);

  if (deciding) {
    return <View style={[styles.center, { backgroundColor: c.background }]}><ActivityIndicator /></View>;
  }

  if (signedIn && me.status === 'error') {
    return (
      <View style={[styles.center, styles.pad, { backgroundColor: c.background }]}>
        <Text style={[styles.title, { color: c.label }]}>Cannot load your workspace</Text>
        <Text style={[styles.body, { color: c.secondaryLabel }]}>{me.message}</Text>
        <Button title="Try again" onPress={() => session && loadMe(session.user.id)} />
        <Button variant="plain" title="Sign out" onPress={() => void signOutCurrentAccount().catch((err) => Alert.alert('Could not sign out', err instanceof Error ? err.message : 'Try again.'))} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      {/* Navigators own safe-area spacing; the keyboard provider must not add it again. */}
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>
      <ThemeProvider value={theme}>
        <Stack key={session?.user.id ?? "signed-out"} screenOptions={{ headerTintColor: tint, headerTitleStyle: { color: c.label }, headerStyle: { backgroundColor: c.background }, headerTransparent: false, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
          {/* Sign-in owns its authenticated redirect so invitation params survive login. */}
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />

          <Stack.Protected guard={signedIn && ready && !hasWorkspace}>
            <Stack.Screen name="onboarding" />
          </Stack.Protected>

          <Stack.Protected guard={hasWorkspace}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="thread/[id]" options={{ title: '' }} />
            <Stack.Screen name="attachment/[id]" options={{ title: 'Attachment' }} />
            <Stack.Screen name="compose" options={{ presentation: 'modal', title: 'New message' }} />
            <Stack.Screen
              name="snooze"
              options={{ presentation: 'formSheet', title: 'Snooze until', sheetAllowedDetents: [0.55, 1], sheetGrabberVisible: true }}
            />
            <Stack.Screen
              name="organize"
              options={{ presentation: 'formSheet', title: 'Move and label', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }}
            />
            <Stack.Screen name="people/index" options={{ title: 'People and access' }} />
            <Stack.Screen name="people/invite" options={{ presentation: 'modal', title: 'Invite someone' }} />
            <Stack.Screen name="setup" options={{ title: 'Email setup' }} />
            <Stack.Screen name="notifications" options={{title:'Notifications'}} />
            <Stack.Screen name="sending" options={{ title: 'Sending' }} />
            <Stack.Screen name="mailboxes/index" options={{ title: 'Manage mailboxes' }} />
            <Stack.Screen name="mailboxes/new" options={{ title: 'Create mailbox' }} />
            <Stack.Screen name="mailboxes/[id]" options={{ title: 'Mailbox access' }} />
            <Stack.Screen name="folders" options={{ presentation: 'transparentModal', headerShown: false, animation: 'slide_from_left', contentStyle: { backgroundColor: 'transparent' } }} />
            <Stack.Screen name="account-security" options={{ title: 'Account security' }} />
          </Stack.Protected>

          <Stack.Screen name="index" options={{ headerShown: false }} />
          {/* Invite links open whether or not someone is signed in. */}
          <Stack.Screen name="invite/[token]" options={{ title: 'Invitation' }} />
          <Stack.Screen name="legal" options={{ title: 'Legal' }} />
          <Stack.Screen name="forgot-password" options={{ title: 'Reset password' }} />
        </Stack>
        {hasWorkspace ? <><NotificationObserver userId={session!.user.id} /><UndoBar /></> : null}
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  pad: { padding: 24 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
});
