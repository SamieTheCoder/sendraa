import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';

import { Button } from '@/components/form';
import { Icon } from '@/components/icon';
import { Mark } from '@/components/logo';
import { AuthGradient, useColors, useScheme } from '@/theme/colors';

const pages = [
  { title: 'Your domain. Your inbox.', body: 'Professional email for your team, with mail infrastructure in your own Cloudflare account.', detail: 'Read, search and organise your mail in Sendraa.', icon: 'mail' as const, symbol: 'envelope' as const },
  { title: 'Connect Cloudflare', body: 'Sign in with Cloudflare, choose your account, then select the domain you want to use for email.', detail: 'An account administrator connects the domain. Invited teammates join the existing workspace.', icon: 'cloud' as const, symbol: 'cloud' as const },
  { title: 'Make it your mailbox', body: 'Sendraa guides you through domain setup and creates your mailbox. Messages and attachments live in your Cloudflare account.', detail: 'Receiving and sending are separate setup steps. You can review domain status before configuring a sending provider.', icon: 'inbox' as const, symbol: 'tray' as const },
];

export function AuthBackdrop() {
  const dark = useScheme() === 'dark';
  return <LinearGradient pointerEvents="none" colors={dark ? AuthGradient.dark : AuthGradient.light} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />;
}

export function WelcomeFlow({ onFinish }: { onFinish: () => void }) {
  const [page, setPage] = useState(0);
  const c = useColors();
  const insets = useSafeAreaInsets();
  const current = pages[page]!;
  const glass = isLiquidGlassAvailable();
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <AuthBackdrop />
    <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.top}>
        {page > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Previous introduction" onPress={() => setPage(page - 1)}>
          <GlassView isInteractive style={[styles.back, !glass && { backgroundColor: c.cell }]}><Icon ios="chevron.left" android="arrow_back" color={c.label} /></GlassView>
        </Pressable> : <Mark size={32} color={c.tint} />}
        <Button title="Sign in" variant="plain" size="compact" onPress={onFinish} />
      </View>
      <View style={styles.story}>
        <GlassView style={[styles.art, !glass && { backgroundColor: c.cell }]}>
          <Icon ios={current.symbol} android={current.icon} size={64} color={c.tint} />
        </GlassView>
        <Text accessibilityRole="header" style={[styles.title, { color: c.label }]}>{current.title}</Text>
        <Text style={[styles.body, { color: c.label }]}>{current.body}</Text>
        <Text style={[styles.detail, { color: c.secondaryLabel }]}>{current.detail}</Text>
      </View>
      <View style={styles.actions}>
        <Text style={{ textAlign: 'center', color: c.secondaryLabel, fontSize: 14 }} accessibilityLabel={`Introduction, page ${page + 1} of ${pages.length}`}>{page + 1} of {pages.length}</Text>
        <Button title={page === pages.length - 1 ? 'Get started' : 'Continue'} variant="brand" onPress={() => page === pages.length - 1 ? onFinish() : setPage(page + 1)} />
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, paddingHorizontal: 24, width: '100%', maxWidth: 480, alignSelf: 'center', justifyContent: 'space-between', gap: 32 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  story: { gap: 20, paddingVertical: 24 },
  art: { width: 112, height: 112, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 36, lineHeight: 40, fontWeight: '700', letterSpacing: -1 },
  body: { fontSize: 18, lineHeight: 27 },
  detail: { fontSize: 15, lineHeight: 23 },
  actions: { gap: 16 },
});
