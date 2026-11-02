import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';

import { useColors } from '@/theme/colors';

/**
 * The Strip mark: a pasted telegram strip, cut on one end and pointed on the other.
 * One white PNG tinted at runtime (brand/icons/render.mjs renders it), so it can be
 * ink on yellow or yellow on ink. `size` is the height; the strip is 64 × 44.
 */
export function Mark({ size = 24, color }: { size?: number; color?: ColorValue }) {
  const c = useColors();
  return (
    <Image
      source={require('../../assets/images/mark.png')}
      tintColor={(color ?? c.label) as string}
      style={{ width: (size * 64) / 44, height: size }}
      contentFit="contain"
      accessible={false}
    />
  );
}

/** League Gothic appears here and nowhere else in the app (brand rules). */
export function Wordmark({ size = 44, color }: { size?: number; color?: ColorValue }) {
  const c = useColors();
  return (
    <Text
      style={[styles.wordmark, { fontSize: size, lineHeight: size * 1.02, color: color ?? c.label }]}
      accessibilityRole="text"
      accessibilityLabel="Sendraa"
      maxFontSizeMultiplier={1.3}
    >
      sendraa
    </Text>
  );
}

/** Mark and wordmark side by side, sized from the wordmark. Spacing follows the brand board (.28em). */
export function Lockup({ size = 32, color }: { size?: number; color?: ColorValue }) {
  return (
    <View style={[styles.lockup, { gap: size * 0.22 }]} accessible accessibilityLabel="Sendraa">
      <Mark size={size * 0.78} color={color} />
      <Wordmark size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center' },
  // League Gothic is very condensed, so it gets a little positive tracking at display size.
  wordmark: { fontFamily: 'LeagueGothic', letterSpacing: 0.6 },
});
