import { Color } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { DynamicColorIOS, Platform, useColorScheme as useSystemScheme, type ColorValue } from 'react-native';

const noopSubscribe = () => () => {};

/**
 * The colour scheme, safe for web server rendering. The server cannot know the browser's scheme and
 * always renders light, so on web the first client render also reports light. After hydration it
 * switches to the real scheme. Otherwise the server HTML and the client disagree and React throws
 * a hydration mismatch. Native has no server render, so it uses the system value directly.
 * Use this instead of react-native's useColorScheme everywhere in the app.
 */
export function useScheme(): 'light' | 'dark' {
  const system = useSystemScheme();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (Platform.OS === 'web' && !hydrated) return 'light';
  return system === 'dark' ? 'dark' : 'light';
}

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
  /** Resting fill inside a text box. Translucent, so it reads on any surface. */
  inputFill: ColorValue;
  /** Text box outline. At least 3:1 against the surface it sits on (WCAG 1.4.11). */
  inputBorder: ColorValue;
  red: ColorValue;
  green: ColorValue;
  /** Pale telegraph-yellow ground for the address strip and other brand moments. */
  soft: ColorValue;
  orange: ColorValue;
  yellow: ColorValue;
  blue: ColorValue;
  /** Text and icons placed on the yellow brand fill. */
  onBrand: string;
  brand: string;
};

// Built only on iOS. DynamicColorIOS and PlatformColor do not exist on web or Android, and this
// module is also evaluated by the web server renderer, so nothing iOS-only may run at import time.
const iosPalette: Palette | null = Platform.OS === 'ios' ? {
  tint,
  label: Color.ios.label,
  secondaryLabel: Color.ios.secondaryLabel,
  tertiaryLabel: DynamicColorIOS({ light: '#686868', dark: '#A6A6AA' }),
  background: Color.ios.systemBackground,
  groupedBackground: Color.ios.systemGroupedBackground,
  cell: Color.ios.secondarySystemGroupedBackground,
  separator: Color.ios.separator,
  fill: Color.ios.tertiarySystemFill,
  inputFill: Color.ios.quaternarySystemFill,
  inputBorder: Color.ios.systemGray,
  red: Color.ios.systemRed,
  green: Color.ios.systemGreen,
  soft: DynamicColorIOS({ light: '#FCEFB4', dark: '#2B2513' }),
  orange: Color.ios.systemOrange,
  yellow: Color.ios.systemYellow,
  blue: Color.ios.systemBlue,
  onBrand: Brand.ink,
  brand: Brand.yellow,
} : null;

// Android has no system palette to defer to, so these come from the Telegram neutral ramp.
const lightPalette: Palette = {
  tint: Brand.tintLight,
  label: '#16130E',
  secondaryLabel: '#625A4C',
  tertiaryLabel: '#706757',
  background: '#FFFFFF',
  groupedBackground: '#F3F2EE',
  cell: '#FFFFFF',
  separator: '#E1DED6',
  fill: '#ECEAE4',
  inputFill: 'rgba(22, 19, 14, 0.04)',
  inputBorder: '#8C8474',
  red: '#C62828',
  green: '#2E7D32',
  soft: '#FCEFB4',
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
  tertiaryLabel: '#A99D85',
  background: '#16130E',
  groupedBackground: '#16130E',
  cell: '#221E17',
  separator: '#3A3328',
  fill: '#2B2620',
  inputFill: 'rgba(243, 242, 238, 0.06)',
  inputBorder: '#7D7363',
  red: '#FF6B6B',
  green: '#7BC67E',
  soft: '#2B2513',
  orange: '#FFA94D',
  yellow: '#FFD43B',
  blue: '#74C0FC',
  onBrand: Brand.ink,
  brand: Brand.yellow,
};

export function useColors(): Palette {
  const scheme = useScheme();
  if (iosPalette) return iosPalette;
  return scheme === 'dark' ? darkPalette : lightPalette;
}

/** Plain hex tint for APIs that cannot take a dynamic colour. */
export function useTintHex(): string {
  return useScheme() === 'dark' ? Brand.tintDark : Brand.tintLight;
}

const AVATAR_COLORS = ['#7A5400', '#0F6E68', '#7A1E3A', '#1E3A8A', '#A8470B', '#4A3FD8', '#6B5752', '#1F4D3A'];

/** Stable colour for a sender avatar, derived from their address. */
export function avatarColor(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i += 1) hash = (hash * 31 + address.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

/** Warm telegraph light for the introduction and authentication only. */
export const AuthGradient = {
  light: ['#FFF4CC', '#FFFFFF', '#F3F2EE'],
  dark: ['#352B10', '#16130E', '#16130E'],
} as const;
