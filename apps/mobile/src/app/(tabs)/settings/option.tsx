import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { Row, Section } from '@/components/grouped-list';
import { updateSettings, useMail } from '@/mail/store';
import type { Settings } from '@/mail/types';
import { useColors } from '@/theme/colors';

type OptionSet = {
  title: string;
  footer: string;
  choices: { label: string; selected: (s: Settings) => boolean; apply: () => void }[];
};

const SETS: Record<string, OptionSet> = {
  undoSend: {
    title: 'Undo send',
    footer: 'How long you have to take a message back after tapping Send.',
    choices: ([5, 10, 20, 30] as const).map((n) => ({
      label: `${n} seconds`,
      selected: (s) => s.undoSendSeconds === n,
      apply: () => updateSettings({ undoSendSeconds: n }),
    })),
  },
  defaultReply: {
    title: 'Default reply',
    footer: 'What the reply button in a notification does.',
    choices: [
      { label: 'Reply', selected: (s) => s.defaultReply === 'reply', apply: () => updateSettings({ defaultReply: 'reply' }) },
      { label: 'Reply all', selected: (s) => s.defaultReply === 'replyAll', apply: () => updateSettings({ defaultReply: 'replyAll' }) },
    ],
  },

};

export default function OptionScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const state = useMail();
  const c = useColors();
  if (key === 'notifications') return <Redirect href="/notifications" />;
  const set = SETS[key ?? ''];
  if (!set) return null;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }}>
      <Stack.Screen options={{ title: set.title }} />
      <Section footer={set.footer}>
        {set.choices.map((choice) => (
          <Row key={choice.label} title={choice.label} checked={choice.selected(state.settings)} onPress={choice.apply} />
        ))}
      </Section>
    </ScrollView>
  );
}
