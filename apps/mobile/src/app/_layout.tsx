import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { UndoBar } from '@/components/undo-bar';
import { useTintHex } from '@/theme/colors';

export default function RootLayout() {
  const scheme = useColorScheme();
  const tint = useTintHex();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: tint } };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <Stack screenOptions={{ headerTintColor: tint, headerBackButtonDisplayMode: 'minimal' }}>
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
        </Stack>
        <UndoBar />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
