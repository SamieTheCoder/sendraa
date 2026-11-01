import { Stack } from 'expo-router';

import { useTintHex } from '@/theme/colors';

export default function MailLayout() {
  const tint = useTintHex();
  return <Stack screenOptions={{ headerTintColor: tint, headerLargeTitle: true, headerTransparent: process.env.EXPO_OS === 'ios', headerBlurEffect: 'systemChromeMaterial' }} />;
}
