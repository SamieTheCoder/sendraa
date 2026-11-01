import { Color } from 'expo-router';
import { DynamicColorIOS, Platform, useColorScheme, type ColorValue } from 'react-native';

/**
 * Telegram, the chosen Sendraa scheme (brand/sendraa-brand.html).
 *
 * The app follows Apple's design, so brand colour appears in a few places only:
 * the tint (buttons, links, selected tab), the app icon, the sign-in mark and
 * the one primary button per screen. Everything else uses system colours so
 * light, dark and increased contrast modes work automatically.
 */
export const Brand = {
  /** Telegraph yellow. A fill only, never text on white. */
  yellow: '#F5C400',
  /** Text and marks placed on the yellow fill. */
  ink: '#16130E',
  /** Tint in light mode. Yellow fails contrast on white, so light mode uses deep amber (7.0:1). */
  tintLight: '#7A5400',
  /** Tint in dark mode. */
  tintDark: '#F5C400',
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
  /** Text and icons placed on the yellow brand fill. */
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
  brand: Brand.yellow,
};

// Android has no system palette to defer to, so these come from the Telegram neutral ramp.
const lightPalette: Palette = {
  tint: Brand.tintLight,
  label: '#16130E',
  secondaryLabel: '#625A4C',
  tertiaryLabel: '#847C6D',
  background: '#FFFFFF',
  groupedBackground: '#F3F2EE',
  cell: '#FFFFFF',
  separator: '#E1DED6',
  fill: '#ECEAE4',
  red: '#C62828',
  orange: '#E65100',
  yellow: '#F9A825',
  blue: '#1565C0',
  onBrand: Brand.ink,
  brand: Brand.yellow,
};

const darkPalette: Palette = {
  tint: Brand.tintDark,
  label: '#F3F2EE',
  secondaryLabel: '#A99D85',
  tertiaryLabel: '#847C6D',
  background: '#16130E',
  groupedBackground: '#16130E',
  cell: '#221E17',
  separator: '#3A3328',
  fill: '#2B2620',
  red: '#FF6B6B',
  orange: '#FFA94D',
  yellow: '#FFD43B',
  blue: '#74C0FC',
  onBrand: Brand.ink,
  brand: Brand.yellow,
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

const AVATAR_COLORS = ['#7A5400', '#0F6E68', '#7A1E3A', '#1E3A8A', '#A8470B', '#4A3FD8', '#6B5752', '#1F4D3A'];

/** Stable colour for a sender avatar, derived from their address. */
export function avatarColor(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i += 1) hash = (hash * 31 + address.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}
