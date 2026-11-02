import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, type ColorValue } from 'react-native';

import type { AndroidSymbol } from 'expo-symbols';

import { Icon } from '@/components/icon';
import type { SFSymbol } from '@/theme/symbols';
import { Brand, useColors, useTintHex } from '@/theme/colors';

/** An inset grouped section, like iOS Settings. */
/** `inset` lines separators up with row titles: 'icon' for rows with an icon tile. */
export function Section({ title, footer, children, inset }: { title?: string; footer?: string; children: ReactNode; inset?: 'icon' }) {
  const c = useColors();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.section}>
      {title ? <Text style={[styles.header, { color: c.secondaryLabel }]}>{title}</Text> : null}
      <View style={[styles.group, { backgroundColor: c.cell }]}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {child}
            {i < items.length - 1 ? <View style={[styles.separator, inset === 'icon' && styles.separatorIcon, { backgroundColor: c.separator }]} /> : null}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={[styles.footer, { color: c.secondaryLabel }]}>{footer}</Text> : null}
    </View>
  );
}

type RowProps = {
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  /** Shows a chevron, for rows that open another screen. */
  navigates?: boolean;
  checked?: boolean;
  destructive?: boolean;
  tinted?: boolean;
  accessory?: ReactNode;
  leading?: ReactNode;
  /** A small monochrome glyph on a quiet tile, before the title. */
  icon?: { ios: SFSymbol; android: AndroidSymbol };
  /** Colours the value text, for statuses such as "Ready" or "Needs attention". */
  valueColor?: ColorValue;
};

export function Row({ title, subtitle, value, onPress, navigates, checked, destructive, tinted, accessory, leading, icon, valueColor }: RowProps) {
  const c = useColors();
  const color: ColorValue = destructive ? c.red : tinted ? c.tint : c.label;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? { backgroundColor: c.fill } : null]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={checked !== undefined ? { checked } : undefined}
    >
      {leading}
      {icon ? (
        <View style={[styles.iconTile, { backgroundColor: destructive ? 'transparent' : c.fill }]}>
          <Icon ios={icon.ios} android={icon.android} size={17} color={destructive ? c.red : c.label} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.title, { color }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: c.secondaryLabel }]}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={[styles.value, { color: valueColor ?? c.secondaryLabel }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {accessory}
      {checked ? <Icon ios="checkmark" android="check" size={17} color={c.tint} /> : null}
      {navigates ? <Icon ios="chevron.right" android="chevron_right" size={14} color={c.tertiaryLabel} /> : null}
    </Pressable>
  );
}

export function SwitchRow({ title, subtitle, value, onValueChange }: { title: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const tint = useTintHex();
  return (
    <Row
      title={title}
      subtitle={subtitle}
      accessory={
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ true: tint === Brand.tintDark ? Brand.yellow : Brand.tintLight }}
          accessibilityLabel={title}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24, marginHorizontal: 16 },
  header: { fontSize: 15, fontWeight: '600', marginLeft: 16, marginBottom: 8 },
  footer: { fontSize: 13, marginHorizontal: 16, marginTop: 6, lineHeight: 18 },
  group: { borderRadius: 12, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  separatorIcon: { marginLeft: 58 },
  iconTile: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: 17 },
  subtitle: { fontSize: 13 },
  value: { fontSize: 16, maxWidth: '50%' },
});
