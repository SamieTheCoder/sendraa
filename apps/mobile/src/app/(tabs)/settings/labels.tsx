import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextBox } from '@/components/form';
import { Icon } from '@/components/icon';
import { Row, Section } from '@/components/grouped-list';
import { createLabel, deleteLabel, renameLabel, useMail } from '@/mail/store';
import { useColors } from '@/theme/colors';

export default function LabelsScreen() {
  const state = useMail();
  const c = useColors();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!name.trim()) return;
    if (!createLabel(name)) {
      setError(`You already have a label called "${name.trim()}".`);
      return;
    }
    setName('');
    setError(null);
  };

  const confirmDelete = (id: string, label: string) =>
    Alert.alert(`Delete "${label}"?`, 'The label is removed from every conversation. The mail itself stays.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteLabel(id) },
    ]);

  return (
    <KeyboardAwareScrollView bottomOffset={24} contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} keyboardShouldPersistTaps="handled">
      <Section title="Your labels" footer="Tap a label to rename it.">
        {state.labels.length === 0 ? <Row title="No labels yet" /> : null}
        {state.labels.map((l) =>
          editing === l.id ? (
            <View key={l.id} style={styles.editRow}>
              <View style={[styles.dot, { backgroundColor: l.color }]} />
              <TextBox
                value={draftName}
                onChangeText={setDraftName}
                autoFocus
                boxStyle={styles.box}
                returnKeyType="done"
                onSubmitEditing={() => {
                  renameLabel(l.id, draftName);
                  setEditing(null);
                }}
                onBlur={() => setEditing(null)}
                accessibilityLabel="Label name"
              />
            </View>
          ) : (
            <Row
              key={l.id}
              title={l.name}
              leading={<View style={[styles.dot, { backgroundColor: l.color }]} />}
              onPress={() => {
                setEditing(l.id);
                setDraftName(l.name);
              }}
              accessory={
                <Pressable onPress={() => confirmDelete(l.id, l.name)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${l.name}`}>
                  <Icon ios="minus.circle.fill" android="remove_circle" size={20} color={c.red} />
                </Pressable>
              }
            />
          ),
        )}
      </Section>

      <Section title="New label">
        <View style={styles.newRow}>
          <TextBox
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder="Label name"
            invalid={Boolean(error)}
            boxStyle={styles.box}
            returnKeyType="done"
            onSubmitEditing={add}
            accessibilityLabel="New label name"
          />
          <Pressable onPress={add} disabled={!name.trim()} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: name.trim() ? c.tint : c.tertiaryLabel, fontSize: 17, fontWeight: '600' }}>Add</Text>
          </Pressable>
        </View>
      </Section>
      {error ? <Text style={[styles.error, { color: c.red }]}>{error}</Text> : null}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: 6 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 46 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  box: { flex: 1 },
  error: { fontSize: 13, marginHorizontal: 32, marginTop: 6 },
});
