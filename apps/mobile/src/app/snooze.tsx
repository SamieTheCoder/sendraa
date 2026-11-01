import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { Icon } from '@/components/icon';
import { Row, Section } from '@/components/grouped-list';
import { snooze } from '@/mail/store';
import { useColors } from '@/theme/colors';

function at(daysFromNow: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function nextDay(weekday: number, hour: number): Date {
  const d = new Date();
  const add = ((weekday - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + add);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const fmt = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export default function SnoozeSheet() {
  const { ids, close } = useLocalSearchParams<{ ids: string; close?: string }>();
  const c = useColors();
  const now = new Date();

  const options = [
    ...(now.getHours() < 17 ? [{ title: 'Later today', date: at(0, 18), ios: 'sun.haze' as const, android: 'wb_twilight' as const }] : []),
    { title: 'Tomorrow', date: at(1, 8), ios: 'sunrise' as const, android: 'wb_sunny' as const },
    { title: 'This weekend', date: nextDay(6, 8), ios: 'sofa' as const, android: 'weekend' as const },
    { title: 'Next week', date: nextDay(1, 8), ios: 'briefcase' as const, android: 'work' as const },
    { title: 'In a month', date: at(30, 8), ios: 'calendar' as const, android: 'calendar_month' as const },
  ];

  const choose = (date: Date) => {
    snooze((ids ?? '').split(',').filter(Boolean), date);
    // From a conversation, snoozing also closes the conversation behind the sheet.
    router.dismiss(close === '1' ? 2 : 1);
  };

  return (
    <ScrollView style={{ backgroundColor: c.groupedBackground }} contentInsetAdjustmentBehavior="automatic">
      <Section footer="The conversation leaves your inbox and comes back at the top at this time.">
        {options.map((o) => (
          <Row
            key={o.title}
            title={o.title}
            value={fmt(o.date)}
            onPress={() => choose(o.date)}
            leading={<Icon ios={o.ios} android={o.android} size={20} color={c.tint} />}
          />
        ))}
      </Section>
    </ScrollView>
  );
}
