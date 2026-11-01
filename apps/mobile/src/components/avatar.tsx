import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { initials } from '@/mail/format';
import { avatarColor, useColors } from '@/theme/colors';

type Props = {
  name: string;
  address: string;
  size?: number;
  /** In selection mode the avatar becomes a checkbox, as in Gmail. */
  selected?: boolean;
};

export function Avatar({ name, address, size = 40, selected }: Props) {
  const c = useColors();
  const box = { width: size, height: size, borderRadius: size / 2 };

  if (selected) {
    return (
      <View style={[styles.base, box, { backgroundColor: c.brand }]}>
        <Icon ios="checkmark" android="check" size={size * 0.45} color={c.onBrand} />
      </View>
    );
  }

  return (
    <View style={[styles.base, box, { backgroundColor: avatarColor(address) }]} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={[styles.text, { fontSize: size * 0.38 }]} allowFontScaling={false}>
        {initials(name || address)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFFFFF', fontWeight: '600' },
});
