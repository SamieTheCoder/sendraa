import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ThreadRow } from '@/components/thread-row';
import { search } from '@/mail/selectors';
import { addRecentSearch, clearRecentSearches, useMail } from '@/mail/store';
import { useColors } from '@/theme/colors';

const FILTERS = [
  { label: 'Unread', query: 'is:unread' },
  { label: 'Starred', query: 'is:starred' },
  { label: 'Attachments', query: 'has:attachment' },
  { label: 'Important', query: 'is:important' },
  { label: 'Sent', query: 'in:sent' },
];

export default function SearchScreen() {
  const state = useMail();
  const c = useColors();
  const [query, setQuery] = useState('');
  const results = useMemo(() => search(state, query), [state, query]);
  const trimmed = query.trim();

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <Stack.SearchBar
        placeholder="Search mail"
        autoCapitalize="none"
        onChangeText={(e) => setQuery(e.nativeEvent.text)}
        onSearchButtonPress={(e) => addRecentSearch(e.nativeEvent.text)}
        onCancelButtonPress={() => setQuery('')}
      />

      {trimmed ? (
        <FlatList
          data={results}
          keyExtractor={(t) => t.id}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          style={{ backgroundColor: c.background }}
          renderItem={({ item }) => (
            <ThreadRow thread={item} state={state} selecting={false} selected={false} onToggleSelect={() => {}} swipe={false} />
          )}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.separator }]} />}
          ListHeaderComponent={
            results.length > 0 ? (
              <Text style={[styles.count, { color: c.secondaryLabel }]}>
                {results.length === 1 ? '1 conversation' : `${results.length} conversations`}
              </Text>
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyState
              ios="magnifyingglass"
              android="search"
              title={`No results for "${trimmed}"`}
              message="Check the spelling, or try from:, to:, subject:, label: or has:attachment."
            />
          }
        />
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" style={{ backgroundColor: c.background }}>
          <Text style={[styles.heading, { color: c.secondaryLabel }]}>Filters</Text>
          <View style={styles.chips}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.query}
                onPress={() => setQuery(f.query)}
                style={({ pressed }) => [styles.chip, { borderColor: c.separator, backgroundColor: pressed ? c.fill : 'transparent' }]}
                accessibilityRole="button"
                accessibilityHint={`Searches for ${f.query}`}
              >
                <Text style={{ color: c.label, fontSize: 15 }}>{f.label}</Text>
              </Pressable>
            ))}
          </View>

          {state.recentSearches.length > 0 ? (
            <>
              <View style={styles.recentHead}>
                <Text style={[styles.heading, { color: c.secondaryLabel, marginTop: 0 }]}>Recent</Text>
                <Pressable onPress={clearRecentSearches} hitSlop={8} accessibilityRole="button">
                  <Text style={{ color: c.tint, fontSize: 15 }}>Clear</Text>
                </Pressable>
              </View>
              {state.recentSearches.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => setQuery(q)}
                  style={({ pressed }) => [styles.recent, pressed && { backgroundColor: c.fill }]}
                  accessibilityRole="button"
                >
                  <Icon ios="clock.arrow.circlepath" android="history" size={18} color={c.secondaryLabel} />
                  <Text style={{ color: c.label, fontSize: 16 }}>{q}</Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <Text style={[styles.tip, { color: c.tertiaryLabel }]}>
            Search works on names, addresses, subjects, message text and file names. Narrow it with from:, to:, subject:, label:, has:attachment, is:unread or in:trash.
          </Text>
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 68 },
  count: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
  heading: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, paddingHorizontal: 16, marginTop: 16, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16, marginTop: 24, marginBottom: 4 },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 44 },
  tip: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 28 },
});
