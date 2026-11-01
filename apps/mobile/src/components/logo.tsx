import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/theme/colors';

/**
 * The Strip mark on its telegraph-yellow tile, and the League Gothic wordmark.
 * League Gothic appears here and nowhere else in the app (brand rules).
 * The PNG is rendered from the brand board by brand/icons/render.mjs.
 */
export function BrandTile({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/images/brand-tile.png')}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}

export function Wordmark({ size = 44 }: { size?: number }) {
  const c = useColors();
  return (
    <Text
      style={[styles.wordmark, { fontSize: size, lineHeight: size * 1.02, color: c.label }]}
      accessibilityRole="header"
      accessibilityLabel="Sendraa"
      maxFontSizeMultiplier={1.3}
    >
      sendraa
    </Text>
  );
}

export function Lockup({ size = 44 }: { size?: number }) {
  return (
    <View style={styles.lockup}>
      <BrandTile size={size * 1.6} />
      <Wordmark size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { alignItems: 'center', gap: 14 },
  // League Gothic is very condensed, so it gets a little positive tracking at display size.
  wordmark: { fontFamily: 'LeagueGothic', letterSpacing: 0.6 },
});
