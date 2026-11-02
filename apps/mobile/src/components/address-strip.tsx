import { StyleSheet, Text, View, type ColorValue } from 'react-native';

import { useColors } from '@/theme/colors';

/**
 * An email address on a pasted telegram strip: pale yellow, scissor-cut on the left like the Strip
 * mark. It marks "this address is yours" wherever the app shows the signed-in address.
 * `ground` is the colour of the surface it sits on, which shows through the cut.
 */
export function AddressStrip({ address, ground, size = 'regular' }: { address: string; ground: ColorValue; size?: 'regular' | 'small' }) {
  const c = useColors();
  const small = size === 'small';
  const notch = small ? 8 : 10;
  return (
    <View style={[styles.strip, { backgroundColor: c.soft, paddingLeft: notch + (small ? 8 : 10), paddingVertical: small ? 4 : 7 }]}>
      <View style={[styles.notch, { width: notch * 1.42, height: notch * 1.42, left: -notch * 0.71, marginTop: -notch * 0.71, backgroundColor: ground }]} />
      <Text selectable numberOfLines={1} style={[styles.text, { color: c.label, fontSize: small ? 14 : 16 }]}>{address}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { alignSelf: 'flex-start', maxWidth: '100%', overflow: 'hidden', paddingRight: 14, justifyContent: 'center' },
  // A square turned 45° and filled with the ground colour cuts the V into the left edge.
  notch: { position: 'absolute', top: '50%', transform: [{ rotate: '45deg' }] },
  text: { fontWeight: '500', fontVariant: ['tabular-nums'] },
});
