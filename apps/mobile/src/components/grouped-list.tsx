import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, type ColorValue } from 'react-native';

import { Icon } from '@/components/icon';
import { Brand, useColors, useTintHex } from '@/theme/colors';

/** An inset grouped section, like iOS Settings. */
export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const c = useColors();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.section}>
      {title ? <Text style={[styles.header, { color: c.secondaryLabel }]}>{title}</Text> : null}
      <View style={[styles.group, { backgroundColor: c.cell }]}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {child}
            {i < items.length - 1 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
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
};

export function Row({ title, subtitle, value, onPress, navigates, checked, destructive, tinted, accessory, leading }: RowProps) {
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
      <View style={styles.rowText}>
        <Text style={[styles.title, { color }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: c.secondaryLabel }]}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={[styles.value, { color: c.secondaryLabel }]} numberOfLines={1}>
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
  header: { fontSize: 13, textTransform: 'uppercase', marginLeft: 16, marginBottom: 6, letterSpacing: 0.2 },
  footer: { fontSize: 13, marginHorizontal: 16, marginTop: 6, lineHeight: 18 },
  group: { borderRadius: 12, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: 17 },
  subtitle: { fontSize: 13 },
  value: { fontSize: 17, maxWidth: '50%' },
});
