import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { HapticPressable as Pressable } from '@/components/haptic-pressable';
import { StyleSheet, Text, View } from 'react-native';

import { TextBox } from '@/components/form';
import { Icon } from '@/components/icon';
import { Row, Section } from '@/components/grouped-list';
import { createLabel, moveTo, toggleLabel, useMail } from '@/mail/store';
import type { Location } from '@/mail/types';
import { useColors } from '@/theme/colors';

const DESTINATIONS: { location: Location; title: string; ios: 'tray' | 'archivebox' | 'exclamationmark.octagon' | 'trash'; android: 'inbox' | 'archive' | 'report' | 'delete' }[] = [
  { location: 'inbox', title: 'Inbox', ios: 'tray', android: 'inbox' },
  { location: 'archive', title: 'Archive', ios: 'archivebox', android: 'archive' },
  { location: 'spam', title: 'Spam', ios: 'exclamationmark.octagon', android: 'report' },
  { location: 'trash', title: 'Trash', ios: 'trash', android: 'delete' },
];

export default function OrganizeSheet() {
  const { ids: raw, close } = useLocalSearchParams<{ ids: string; close?: string }>();
  const ids = (raw ?? '').split(',').filter(Boolean);
  const state = useMail();
  const c = useColors();
  const [newLabel, setNewLabel] = useState('');
  const threads = state.threads.filter((t) => ids.includes(t.id));
  const current = threads.length === 1 ? threads[0]!.location : null;

  const addLabel = () => {
    const label = createLabel(newLabel);
    if (label) {
      toggleLabel(ids, label.id, true);
      setNewLabel('');
    }
  };

  return (
    <KeyboardAwareScrollView bottomOffset={24} style={{ backgroundColor: c.groupedBackground }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <Section title="Move to">
        {DESTINATIONS.map((d) => (
          <Row
            key={d.location}
            title={d.title}
            checked={current === d.location}
            leading={<Icon ios={d.ios} android={d.android} size={20} color={c.tint} />}
            onPress={() => {
              if (current !== d.location) moveTo(ids, d.location);
              // From a conversation, moving it also closes the conversation behind the sheet.
              router.dismiss(close === '1' && d.location !== current ? 2 : 1);
            }}
          />
        ))}
      </Section>

      <Section title="Labels" footer="A conversation can have several labels. Labels show in the folder menu.">
        {state.labels.map((l) => {
          const on = threads.length > 0 && threads.every((t) => t.labelIds.includes(l.id));
          return (
            <Row
              key={l.id}
              title={l.name}
              checked={on}
              leading={<View style={[styles.dot, { backgroundColor: l.color }]} />}
              onPress={() => toggleLabel(ids, l.id, !on)}
            />
          );
        })}
        <View style={styles.newRow}>
          <TextBox
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder="New label"
            boxStyle={styles.box}
            onSubmitEditing={addLabel}
            returnKeyType="done"
            accessibilityLabel="New label name"
          />
          <Pressable onPress={addLabel} disabled={!newLabel.trim()} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: newLabel.trim() ? c.tint : c.tertiaryLabel, fontSize: 17, fontWeight: '600' }}>Add</Text>
          </Pressable>
        </View>
      </Section>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: 6 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  box: { flex: 1 },
});
