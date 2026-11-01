import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dismissUndo, undo, useUndo } from '@/mail/store';
import { Brand } from '@/theme/colors';

/**
 * The Gmail-style "Archived · Undo" bar. It floats above the tab bar, stays for
 * the entry's duration, and leaves on its own.
 */
export function UndoBar() {
  const entry = useUndo();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!entry) return;
    const timer = setTimeout(() => dismissUndo(entry.key), entry.duration);
    return () => clearTimeout(timer);
  }, [entry]);

  if (!entry) return null;

  return (
    <Animated.View
      key={entry.key}
      entering={FadeInDown.springify().damping(20).reduceMotion(ReduceMotion.System)}
      exiting={FadeOutDown.duration(180).reduceMotion(ReduceMotion.System)}
      style={[styles.bar, { bottom: insets.bottom + 64 }]}
      accessibilityLiveRegion="polite"
      pointerEvents="box-none"
    >
      <Text style={styles.text} numberOfLines={2}>
        {entry.text}
      </Text>
      <Pressable onPress={undo} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Undo. ${entry.text}`}>
        {({ pressed }) => <Text style={[styles.action, pressed && { opacity: 0.6 }]}>Undo</Text>}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#1C1F17',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  text: { flex: 1, color: '#F1F5E8', fontSize: 15 },
  action: { color: Brand.yellow, fontSize: 15, fontWeight: '700' },
});
