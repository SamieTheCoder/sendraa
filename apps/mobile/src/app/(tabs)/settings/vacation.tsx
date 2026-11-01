import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Section, SwitchRow } from '@/components/grouped-list';
import { activeAccount, updateAccountSettings, useMail } from '@/mail/store';
import type { Vacation } from '@/mail/types';
import { useColors } from '@/theme/colors';

export default function VacationScreen() {
  const state = useMail();
  const c = useColors();
  const account = activeAccount(state);
  const vacation = state.settings.accounts[account.id]?.vacation;
  if (!vacation) return null;

  const set = (patch: Partial<Vacation>) => updateAccountSettings(account.id, { vacation: { ...vacation, ...patch } });

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
      <Section footer="While this is on, each person who writes to you gets this reply once every four days. It starts working when the mail service is connected.">
        <SwitchRow title="Vacation responder" value={vacation.enabled} onValueChange={(enabled) => set({ enabled })} />
      </Section>

      {vacation.enabled ? (
        <>
          <Section title="Reply">
            <View>
              <TextInput
                value={vacation.subject}
                onChangeText={(subject) => set({ subject })}
                placeholder="Subject"
                placeholderTextColor={c.tertiaryLabel}
                style={[styles.line, { color: c.label }]}
                accessibilityLabel="Reply subject"
              />
            </View>
            <View>
              <TextInput
                value={vacation.message}
                onChangeText={(message) => set({ message })}
                placeholder="I am away until Monday and will reply when I am back."
                placeholderTextColor={c.tertiaryLabel}
                multiline
                textAlignVertical="top"
                style={[styles.message, { color: c.label }]}
                accessibilityLabel="Reply message"
              />
            </View>
          </Section>
          <Section footer="People you have emailed before. Everyone else gets no reply.">
            <SwitchRow title="Only reply to my contacts" value={vacation.contactsOnly} onValueChange={(contactsOnly) => set({ contactsOnly })} />
          </Section>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 17, paddingHorizontal: 16, paddingVertical: 13 },
  message: { minHeight: 140, fontSize: 16, lineHeight: 22, paddingHorizontal: 16, paddingVertical: 12 },
});
