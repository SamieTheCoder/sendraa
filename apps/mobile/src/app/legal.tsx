import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { legalDocuments, LEGAL_VERSION } from '@/content/legal';
import { useColors } from '@/theme/colors';

export default function LegalScreen() {
  const { document } = useLocalSearchParams<{ document?: string }>();
  const doc = legalDocuments[document === 'terms' ? 'terms' : 'privacy'];
  const c = useColors();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 24, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
      <Stack.Screen options={{ title: doc.title }} />
      <Text selectable style={{ color: c.secondaryLabel, fontSize: 14 }}>Updated {LEGAL_VERSION}</Text>
      <Text selectable style={{ color: c.label, fontSize: 17, lineHeight: 26 }}>{doc.intro}</Text>
      {doc.sections.map((section) => <View key={section.title} style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ color: c.label, fontSize: 20, fontWeight: '600' }}>{section.title}</Text>
        <Text selectable style={{ color: c.label, fontSize: 16, lineHeight: 25 }}>{section.text}</Text>
      </View>)}
    </ScrollView>
  );
}
