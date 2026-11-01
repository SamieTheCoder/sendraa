import { Color } from 'expo-router';
import { DynamicColorIOS, Platform, useColorScheme, type ColorValue } from 'react-native';

/**
 * Midnight lime, the chosen Sendraa scheme.
 *
 * The app follows Apple's design, so brand colour appears in three places only:
 * the tint (buttons, links, selected tab), the app icon, and the leading swipe
 * action. Everything else uses system colours so light, dark and increased
 * contrast modes work automatically.
 */
export const Brand = {
  lime: '#C6F432',
  ink: '#12160A',
  /** Tint in light mode. Lime itself fails contrast on white, so light mode uses dark olive. */
  tintLight: '#4D6B00',
  /** Tint in dark mode. */
  tintDark: '#C6F432',
} as const;

export const tint: ColorValue =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ light: Brand.tintLight, dark: Brand.tintDark })
    : Brand.tintLight;

type Palette = {
  tint: ColorValue;
  label: ColorValue;
  secondaryLabel: ColorValue;
  tertiaryLabel: ColorValue;
  background: ColorValue;
  groupedBackground: ColorValue;
  cell: ColorValue;
  separator: ColorValue;
  fill: ColorValue;
  red: ColorValue;
  orange: ColorValue;
  yellow: ColorValue;
  blue: ColorValue;
  /** Text and icons placed on the lime brand fill. */
  onBrand: string;
  brand: string;
};

const iosPalette: Palette = {
  tint,
  label: Color.ios.label,
  secondaryLabel: Color.ios.secondaryLabel,
  tertiaryLabel: Color.ios.tertiaryLabel,
  background: Color.ios.systemBackground,
  groupedBackground: Color.ios.systemGroupedBackground,
  cell: Color.ios.secondarySystemGroupedBackground,
  separator: Color.ios.separator,
  fill: Color.ios.tertiarySystemFill,
  red: Color.ios.systemRed,
  orange: Color.ios.systemOrange,
  yellow: Color.ios.systemYellow,
  blue: Color.ios.systemBlue,
  onBrand: Brand.ink,
  brand: Brand.lime,
};

const lightPalette: Palette = {
  tint: Brand.tintLight,
  label: '#111111',
  secondaryLabel: '#5C6250',
  tertiaryLabel: '#8A8F82',
  background: '#FFFFFF',
  groupedBackground: '#F2F4EE',
  cell: '#FFFFFF',
  separator: '#DEE2D6',
  fill: '#ECEEE7',
  red: '#C62828',
  orange: '#E65100',
  yellow: '#F9A825',
  blue: '#1565C0',
  onBrand: Brand.ink,
  brand: Brand.lime,
};

const darkPalette: Palette = {
  tint: Brand.tintDark,
  label: '#F1F5E8',
  secondaryLabel: '#A2AC90',
  tertiaryLabel: '#737A66',
  background: '#0D1008',
  groupedBackground: '#0D1008',
  cell: '#171C10',
  separator: '#2A3220',
  fill: '#222A17',
  red: '#FF6B6B',
  orange: '#FFA94D',
  yellow: '#FFD43B',
  blue: '#74C0FC',
  onBrand: Brand.ink,
  brand: Brand.lime,
};

export function useColors(): Palette {
  const scheme = useColorScheme();
  if (Platform.OS === 'ios') return iosPalette;
  return scheme === 'dark' ? darkPalette : lightPalette;
}

/** Plain hex tint for APIs that cannot take a dynamic colour. */
export function useTintHex(): string {
  return useColorScheme() === 'dark' ? Brand.tintDark : Brand.tintLight;
}

const AVATAR_COLORS = ['#4D6B00', '#0F6E68', '#7A1E3A', '#1E3A8A', '#A8470B', '#4A3FD8', '#6B5752', '#1F4D3A'];

/** Stable colour for a sender avatar, derived from their address. */
export function avatarColor(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i += 1) hash = (hash * 31 + address.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}
