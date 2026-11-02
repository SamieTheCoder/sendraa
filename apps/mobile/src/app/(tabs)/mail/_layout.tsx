import { Stack } from 'expo-router';

import { useColors, useTintHex } from '@/theme/colors';

export default function MailLayout() {
  const tint = useTintHex();
  const c = useColors();
  return <Stack screenOptions={{ headerTintColor: tint, headerTitleStyle: { color: c.label }, headerStyle: { backgroundColor: c.background }, headerTransparent: false, headerShadowVisible: false }} />;
}
