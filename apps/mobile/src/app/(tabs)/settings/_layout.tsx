import { Stack } from 'expo-router';

import { useColors, useTintHex } from '@/theme/colors';

export default function SettingsLayout() {
  const tint = useTintHex();
  const c = useColors();
  return (
    <Stack screenOptions={{ headerTintColor: tint, contentStyle: { backgroundColor: c.groupedBackground }, headerTransparent: process.env.EXPO_OS === 'ios', headerBlurEffect: 'systemChromeMaterial' }}>
      <Stack.Screen name="index" options={{ title: 'Settings', headerLargeTitle: true }} />
      <Stack.Screen name="signature" options={{ title: 'Signature' }} />
      <Stack.Screen name="vacation" options={{ title: 'Vacation responder' }} />
      <Stack.Screen name="swipe" options={{ title: 'Swipe actions' }} />
      <Stack.Screen name="labels" options={{ title: 'Labels' }} />
      <Stack.Screen name="option" options={{ title: '' }} />
    </Stack>
  );
}
