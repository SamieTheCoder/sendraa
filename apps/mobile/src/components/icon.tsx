import { SymbolView, type AndroidSymbol } from 'expo-symbols';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';
import type { SFSymbol } from '@/theme/symbols';

type Props = {
  /** SF Symbol name on iOS. */
  ios: SFSymbol;
  /** Material Symbol name on Android and web. */
  android: AndroidSymbol;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
};

/** One icon system per platform: SF Symbols on iOS, Material Symbols elsewhere. */
export function Icon({ ios, android, size = 20, color, style }: Props) {
  return <SymbolView name={{ ios, android, web: android }} size={size} tintColor={color} style={style} />;
}
