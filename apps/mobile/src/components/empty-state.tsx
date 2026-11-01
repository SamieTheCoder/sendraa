import type { AndroidSymbol } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import type { SFSymbol } from '@/theme/symbols';

import { Icon } from '@/components/icon';
import { useColors } from '@/theme/colors';

export function EmptyState({ ios, android, title, message }: { ios: SFSymbol; android: AndroidSymbol; title: string; message?: string }) {
  const c = useColors();
  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Icon ios={ios} android={android} size={44} color={c.tertiaryLabel} />
      <Text style={[styles.title, { color: c.label }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: c.secondaryLabel }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 96, gap: 10 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  message: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
});
