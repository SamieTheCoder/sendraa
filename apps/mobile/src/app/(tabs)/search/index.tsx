import { Stack, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ComponentProps } from 'react';
import { HapticPressable as Pressable } from '@/components/haptic-pressable';
import { FlatList, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { TextBox } from '@/components/form';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ThreadRow } from '@/components/thread-row';
import { search } from '@/mail/selectors';
import { addRecentSearch, clearRecentSearches, useMail } from '@/mail/store';
import { useColors } from '@/theme/colors';

type SearchBarCommands = NonNullable<NonNullable<ComponentProps<typeof Stack.SearchBar>['ref']>['current']>;

// The header search view mounts a beat after the tab switches; focusing earlier is ignored.
const FOCUS_DELAY = Platform.OS === 'android' ? 250 : 120;

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
  const navigation = useNavigation();
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const searchRef = useRef<SearchBarCommands>(null);
  const [query, setQuery] = useState('');
  const results = useMemo(() => search(state, query), [state, query]);
  const trimmed = query.trim();

  const focusSearch = useCallback(() => {
    if (Platform.OS === 'android') inputRef.current?.focus();
    else searchRef.current?.focus();
  }, []);
  useFocusEffect(useCallback(() => {
    const timer = setTimeout(focusSearch, FOCUS_DELAY);
    return () => clearTimeout(timer);
  }, [focusSearch]));
  useEffect(() => {
    const tab = navigation.getParent();
    return tab?.addListener('tabPress' as never, () => {
      if (navigation.isFocused()) focusSearch();
    });
  }, [navigation, focusSearch]);

  const runQuery = (q: string) => {
    searchRef.current?.setText(q);
    setQuery(q);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      {Platform.OS === 'android' ? (
        <View style={{ padding: 16, backgroundColor: c.background }}>
          <TextBox ref={inputRef} value={query} onChangeText={setQuery} placeholder="Search mail" accessibilityLabel="Search mail" autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => addRecentSearch(query)} trailing={query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }}><Icon ios="xmark" android="close" color={c.label} /></Pressable> : undefined} />
        </View>
      ) : <Stack.SearchBar
        ref={searchRef}
        placeholder="Search mail"
        autoCapitalize="none"
        autoFocus
        textColor={c.label}
        hintTextColor={c.secondaryLabel}
        headerIconColor={c.label}
        tintColor={c.tint}
        onChangeText={(e) => setQuery(e.nativeEvent.text)}
        onSearchButtonPress={(e) => addRecentSearch(e.nativeEvent.text)}
        onCancelButtonPress={() => setQuery('')}
        onClose={() => setQuery('')}
      />}

      {trimmed ? (
        <FlatList
          data={results}
          keyExtractor={(t) => t.id}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
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
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" style={{ backgroundColor: c.background }}>
          <Text style={[styles.heading, { color: c.label }]}>Filters</Text>
          <View style={styles.chips}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.query}
                onPress={() => runQuery(f.query)}
                style={({ pressed }) => [styles.chip, { borderColor: c.inputBorder, backgroundColor: pressed ? c.fill : 'transparent' }]}
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
                <Text style={[styles.heading, { color: c.label, marginTop: 0 }]}>Recent</Text>
                <Pressable onPress={clearRecentSearches} hitSlop={8} accessibilityRole="button">
                  <Text style={{ color: c.tint, fontSize: 15 }}>Clear</Text>
                </Pressable>
              </View>
              {state.recentSearches.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => runQuery(q)}
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
  heading: { fontSize: 15, fontWeight: '600', paddingHorizontal: 16, marginTop: 16, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16, marginTop: 24, marginBottom: 4 },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 44 },
  tip: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 28 },
});
