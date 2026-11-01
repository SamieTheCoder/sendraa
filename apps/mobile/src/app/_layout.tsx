import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Button } from '@/components/form';
import { UndoBar } from '@/components/undo-bar';
import { authClient } from '@/lib/auth-client';
import { loadMe, useMe } from '@/lib/workspace';
import { useColors, useTintHex } from '@/theme/colors';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme();
  const tint = useTintHex();
  const c = useColors();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: tint } };

  const { data: session, isPending } = authClient.useSession();
  const me = useMe(session?.user.id);
  const signedIn = Boolean(session);
  const ready = me.status === 'ready';
  const hasWorkspace = ready && me.me.workspaces.length > 0;
  const deciding = isPending || (signedIn && (me.status === 'idle' || me.status === 'loading'));

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
        <Button variant="plain" title="Sign out" onPress={() => authClient.signOut()} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <Stack screenOptions={{ headerTintColor: tint, headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>

          <Stack.Protected guard={signedIn && ready && !hasWorkspace}>
            <Stack.Screen name="onboarding" />
          </Stack.Protected>

          <Stack.Protected guard={hasWorkspace}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="thread/[id]" options={{ title: '' }} />
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
          </Stack.Protected>

          <Stack.Screen name="index" options={{ headerShown: false }} />
          {/* Invite links open whether or not someone is signed in. */}
          <Stack.Screen name="invite/[token]" options={{ title: 'Invitation' }} />
        </Stack>
        {hasWorkspace ? <UndoBar /> : null}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  pad: { padding: 24 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
});
