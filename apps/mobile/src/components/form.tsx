import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import { HapticPressable as Pressable } from '@/components/haptic-pressable';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { Brand, useColors } from '@/theme/colors';

type TextBoxProps = TextInputProps & {
  /** Placed inside the box, after the text: a show/hide control, an Add button. */
  trailing?: ReactNode;
  /** Outline in red, for a field the last attempt rejected. */
  invalid?: boolean;
  boxStyle?: StyleProp<ViewStyle>;
};

/**
 * The one text box every screen uses: a filled, outlined box whose outline turns to the tint while
 * typing. The outline keeps its width when focused so nothing around it moves.
 */
export const TextBox = forwardRef<ComponentRef<typeof TextInput>, TextBoxProps>(function TextBox({ trailing, invalid, boxStyle, style, multiline, onFocus, onBlur, ...props }, ref) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const borderColor = invalid ? c.red : focused ? c.tint : c.inputBorder;
  return (
    <View style={[styles.box, multiline && styles.boxMultiline, { backgroundColor: c.inputFill, borderColor }, boxStyle]}>
      <TextInput
        ref={ref}
        multiline={multiline}
        placeholderTextColor={c.secondaryLabel}
        selectionColor={c.tint}
        cursorColor={c.tint}
        underlineColorAndroid="transparent"
        textAlignVertical={multiline ? 'top' : 'center'}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        style={[styles.input, multiline && styles.inputMultiline, { color: c.label }, style]}
        {...props}
      />
      {trailing}
    </View>
  );
});

/** A text box with its label above it, for forms. Passwords get a Show control. */
export const Field = forwardRef<ComponentRef<typeof TextInput>, TextBoxProps & { label: string }>(function Field({ label, secureTextEntry, ...props }, ref) {
  const c = useColors();
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.label }]}>{label}</Text>
      <TextBox
        ref={ref}
        accessibilityLabel={label}
        secureTextEntry={secureTextEntry && !revealed}
        trailing={secureTextEntry ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            style={styles.reveal}
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            <Text style={[styles.revealText, { color: c.tint }]}>{revealed ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : undefined}
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
  /**
   * brand: the yellow fill, once per screen for the main action.
   * ink: the inverse of the page (ink in light mode, paper in dark). For "Continue with" sign-in.
   * filled: the tint fill. outline: a quiet secondary action. plain: a text button.
   */
  variant?: 'brand' | 'ink' | 'filled' | 'outline' | 'plain';
  /** An icon or logo before the title. */
  leading?: ReactNode;
  /** compact is 44 high, for actions inside a card. */
  size?: 'regular' | 'compact';
  destructive?: boolean;
  accessibilityHint?: string;
};

export function Button({ title, onPress, loading, disabled, variant = 'filled', leading, size = 'regular', destructive, accessibilityHint }: ButtonProps) {
  const c = useColors();
  const bg = { brand: Brand.yellow, ink: c.label, filled: c.tint, outline: 'transparent', plain: 'transparent' }[variant];
  const fg = destructive ? c.red : { brand: Brand.ink, ink: c.background, filled: c.background, outline: c.label, plain: c.tint }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        size === 'compact' && styles.compact,
        variant === 'outline' && { borderWidth: 1, borderColor: c.inputBorder },
        variant === 'plain' && styles.plain,
        { backgroundColor: pressed && variant === 'outline' ? c.fill : bg, opacity: disabled ? 0.45 : pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy: loading }}
    >
      {loading ? <ActivityIndicator color={fg as string} /> : (
        <>
          {leading}
          <Text style={[styles.buttonText, size === 'compact' && styles.compactText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Errors are system red with an icon, so colour is never the only signal (brand rules). */
export function ErrorText({ children }: { children: string | null }) {
  const c = useColors();
  if (!children) return null;
  return (
    <View style={styles.message} accessibilityLiveRegion="polite" accessible accessibilityLabel={`Error: ${children}`}>
      <Icon ios="exclamationmark.circle.fill" android="error" size={18} color={c.red} />
      <Text style={[styles.messageText, { color: c.red }]}>{children}</Text>
    </View>
  );
}

/** A confirmation after a save, in green with a check. */
export function NoticeText({ children }: { children: string | null }) {
  const c = useColors();
  if (!children) return null;
  return (
    <View style={styles.message} accessibilityLiveRegion="polite" accessible accessibilityLabel={children}>
      <Icon ios="checkmark.circle.fill" android="check_circle" size={18} color={c.green} />
      <Text style={[styles.messageText, { color: c.label }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
  box: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, gap: 8 },
  boxMultiline: { alignItems: 'stretch', paddingVertical: 4 },
  input: { flex: 1, minHeight: 48, fontSize: 17, paddingVertical: 12, paddingHorizontal: 0 },
  inputMultiline: { minHeight: 120, lineHeight: 22 },
  reveal: { minHeight: 44, justifyContent: 'center', paddingLeft: 4 },
  revealText: { fontSize: 15, fontWeight: '600' },
  button: { minHeight: 52, borderRadius: 12, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  compact: { minHeight: 44, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  plain: { paddingHorizontal: 8 },
  buttonText: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  compactText: { fontSize: 15 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  messageText: { flex: 1, fontSize: 15, lineHeight: 20 },
});
