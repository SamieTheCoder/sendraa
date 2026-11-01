import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Section, SwitchRow } from '@/components/grouped-list';
import { activeAccount, updateAccountSettings, useMail } from '@/mail/store';
import { useColors } from '@/theme/colors';

export default function SignatureScreen() {
  const state = useMail();
  const c = useColors();
  const account = activeAccount(state);
  const settings = state.settings.accounts[account.id];
  if (!settings) return null;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
      <Section footer={`Used for mail sent from ${account.address}.`}>
        <SwitchRow
          title="Use signature"
          value={settings.signatureEnabled}
          onValueChange={(signatureEnabled) => updateAccountSettings(account.id, { signatureEnabled })}
        />
      </Section>

      {settings.signatureEnabled ? (
        <Section title="Signature" footer="Added below a -- line at the end of new messages, and above the quoted text in replies and forwards.">
          <View>
            <TextInput
              value={settings.signature}
              onChangeText={(signature) => updateAccountSettings(account.id, { signature })}
              multiline
              placeholder={`${account.name}\nYour title`}
              placeholderTextColor={c.tertiaryLabel}
              textAlignVertical="top"
              style={[styles.input, { color: c.label }]}
              accessibilityLabel="Signature"
            />
          </View>
        </Section>
      ) : null}

      {settings.signatureEnabled && settings.signature.trim() ? (
        <Section title="Preview">
          <View style={styles.preview}>
            <Text style={{ color: c.secondaryLabel, fontSize: 15 }}>--</Text>
            <Text style={{ color: c.label, fontSize: 15, lineHeight: 21 }}>{settings.signature.trim()}</Text>
          </View>
        </Section>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 120, fontSize: 16, lineHeight: 22, paddingHorizontal: 16, paddingVertical: 12 },
  preview: { padding: 16, gap: 2 },
});
