import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { StyleSheet, View } from 'react-native';

import { TextBox } from '@/components/form';
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
    <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} keyboardDismissMode="interactive">
      <Section footer="While this is on, each person who writes to you gets this reply once every four days. It starts working when the mail service is connected.">
        <SwitchRow title="Vacation responder" value={vacation.enabled} onValueChange={(enabled) => set({ enabled })} />
      </Section>

      {vacation.enabled ? (
        <>
          <Section title="Reply">
            <View style={styles.boxes}>
              <TextBox
                value={vacation.subject}
                onChangeText={(subject) => set({ subject })}
                placeholder="Subject"
                accessibilityLabel="Reply subject"
              />
              <TextBox
                value={vacation.message}
                onChangeText={(message) => set({ message })}
                placeholder="I am away until Monday and will reply when I am back."
                multiline
                style={styles.message}
                accessibilityLabel="Reply message"
              />
            </View>
          </Section>
          <Section footer="People you have emailed before. Everyone else gets no reply.">
            <SwitchRow title="Only reply to my contacts" value={vacation.contactsOnly} onValueChange={(contactsOnly) => set({ contactsOnly })} />
          </Section>
        </>
      ) : null}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  boxes: { padding: 16, gap: 12 },
  message: { minHeight: 140, fontSize: 16 },
});
