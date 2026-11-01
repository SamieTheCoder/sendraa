import { ScrollView } from 'react-native';

import { Row, Section } from '@/components/grouped-list';
import { SWIPE_NAMES } from '@/mail/selectors';
import { updateSettings, useMail } from '@/mail/store';
import type { SwipeAction } from '@/mail/types';
import { useColors } from '@/theme/colors';

const ACTIONS: SwipeAction[] = ['archive', 'trash', 'read', 'snooze', 'star', 'none'];

export default function SwipeScreen() {
  const state = useMail();
  const c = useColors();
  const { swipeLeading, swipeTrailing } = state.settings;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }}>
      <Section title="Swipe right">
        {ACTIONS.map((a) => (
          <Row key={a} title={SWIPE_NAMES[a]} checked={swipeLeading === a} onPress={() => updateSettings({ swipeLeading: a })} />
        ))}
      </Section>
      <Section title="Swipe left" footer="In Archive, the archive swipe moves mail back to the Inbox. In Trash, the trash swipe deletes forever.">
        {ACTIONS.map((a) => (
          <Row key={a} title={SWIPE_NAMES[a]} checked={swipeTrailing === a} onPress={() => updateSettings({ swipeTrailing: a })} />
        ))}
      </Section>
    </ScrollView>
  );
}
