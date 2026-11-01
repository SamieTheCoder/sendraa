import { forwardRef, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Brand, useColors } from '@/theme/colors';

/** A labelled text field in an inset group, like iOS sign-in screens. */
export const Field = forwardRef<ComponentRef<typeof TextInput>, TextInputProps & { label: string }>(function Field({ label, style, ...props }, ref) {
  const c = useColors();
  return (
    <View style={[styles.field, { backgroundColor: c.cell }]}>
      <Text style={[styles.label, { color: c.secondaryLabel }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={c.tertiaryLabel}
        style={[styles.input, { color: c.label }, style]}
        accessibilityLabel={label}
        {...props}
      />
    </View>
  );
});

type ButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** "brand" is the yellow fill, used once per screen for the main action. */
  variant?: 'brand' | 'filled' | 'plain';
};

export function Button({ title, onPress, loading, disabled, variant = 'filled' }: ButtonProps) {
  const c = useColors();
  const bg = variant === 'brand' ? Brand.yellow : variant === 'filled' ? c.tint : 'transparent';
  const fg = variant === 'brand' ? Brand.ink : variant === 'filled' ? c.background : c.tint;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  const c = useColors();
  if (!children) return null;
  return (
    <Text style={[styles.error, { color: c.red }]} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  field: { borderRadius: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  label: { fontSize: 12, fontWeight: '500' },
  input: { fontSize: 17, paddingVertical: 8 },
  button: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  error: { fontSize: 14, lineHeight: 19 },
});
