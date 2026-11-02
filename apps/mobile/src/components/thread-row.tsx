import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { displayName, listTime, snippet } from '@/mail/format';
import { archive, deleteForever, markRead, moveToInbox, setStarred, trash, type MailState } from '@/mail/store';
import type { SwipeAction, Thread } from '@/mail/types';
import { useColors } from '@/theme/colors';

type Props = {
  thread: Thread;
  state: MailState;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  /** Opens a message row that stands for one message rather than a whole thread. */
  openId?: string;
  swipe?: boolean;
};

/** Gmail's sender line: "Ananya, me (3)". */
function participants(thread: Thread, me: string): string {
  const names: string[] = [];
  for (const m of thread.messages) {
    const label = m.from.address.toLowerCase() === me ? 'me' : displayName(m.from).split(' ')[0]!;
    if (!names.includes(label)) names.push(label);
  }
  const shown = names.length === 1 && names[0] !== 'me' ? displayName(thread.messages[0]!.from) : names.join(', ');
  return thread.messages.length > 1 ? `${shown} (${thread.messages.length})` : shown;
}

function sentLine(thread: Thread): string {
  const last = thread.messages[thread.messages.length - 1]!;
  return `To: ${last.to.map(displayName).join(', ')}`;
}

export function ThreadRow({ thread, state, selecting, selected, onToggleSelect, openId, swipe = true }: Props) {
  const c = useColors();
  const swipeRef = useRef<SwipeableMethods>(null);
  useEffect(() => { if (selecting) swipeRef.current?.reset(); }, [selecting]);
  const last = thread.messages[thread.messages.length - 1]!;
  const account = state.accounts.find((a) => a.id === thread.accountId);
  const me = account?.address.toLowerCase() ?? '';
  const fromMe = last.from.address.toLowerCase() === me;
  const showSent = state.folder === 'sent' || state.folder === 'scheduled' || (fromMe && thread.messages.length === 1);
  const hasAttachment = thread.messages.some((m) => m.attachments.length > 0);
  const avatarPerson = fromMe && last.to[0] ? last.to[0] : last.from;
  const time = thread.scheduledAt ?? last.date;

  const open = () => {
    if (selecting) {
      onToggleSelect(thread.id);
      return;
    }
    router.push({ pathname: '/thread/[id]', params: { id: openId ?? thread.id } });
  };

  const run = (action: SwipeAction) => {
    switch (action) {
      case 'archive':
        if (thread.location === 'archive') moveToInbox([thread.id]);
        else archive([thread.id]);
        break;
      case 'trash':
        if (thread.location === 'trash') deleteForever([thread.id]);
        else trash([thread.id]);
        break;
      case 'read':
        markRead([thread.id], thread.unread);
        swipeRef.current?.close();
        break;
      case 'star':
        setStarred([thread.id], !thread.starred);
        swipeRef.current?.close();
        break;
      case 'snooze':
        swipeRef.current?.close();
        router.push({ pathname: '/snooze', params: { ids: thread.id } });
        break;
      default:
        break;
    }
  };

  const config = (action: SwipeAction) => {
    switch (action) {
      case 'archive':
        return thread.location === 'archive'
          ? { bg: c.blue, fg: '#FFFFFF', ios: 'tray.and.arrow.down' as const, android: 'inbox' as const, label: 'Inbox' }
          : { bg: c.brand, fg: c.onBrand, ios: 'archivebox' as const, android: 'archive' as const, label: 'Archive' };
      case 'trash':
        return { bg: c.red, fg: '#FFFFFF', ios: 'trash' as const, android: 'delete' as const, label: thread.location === 'trash' ? 'Delete' : 'Trash' };
      case 'read':
        return thread.unread
          ? { bg: c.blue, fg: '#FFFFFF', ios: 'envelope.open' as const, android: 'mark_email_read' as const, label: 'Read' }
          : { bg: c.blue, fg: '#FFFFFF', ios: 'envelope.badge' as const, android: 'mark_email_unread' as const, label: 'Unread' };
      case 'star':
        return { bg: c.yellow, fg: '#1A1400', ios: thread.starred ? ('star.slash' as const) : ('star.fill' as const), android: 'star' as const, label: thread.starred ? 'Unstar' : 'Star' };
      case 'snooze':
        return { bg: c.orange, fg: '#FFFFFF', ios: 'clock' as const, android: 'schedule' as const, label: 'Snooze' };
      default:
        return null;
    }
  };

  const leading = swipe ? config(state.settings.swipeLeading) : null;
  const trailing = swipe ? config(state.settings.swipeTrailing) : null;

  const actionView = (cfg: NonNullable<ReturnType<typeof config>>, align: 'flex-start' | 'flex-end') => (
    <View style={[styles.action, { backgroundColor: cfg.bg, alignItems: align }]}>
      <View style={styles.actionInner}>
        <Icon ios={cfg.ios} android={cfg.android} size={22} color={cfg.fg} />
        <Text style={[styles.actionLabel, { color: cfg.fg }]}>{cfg.label}</Text>
      </View>
    </View>
  );

  const weight = thread.unread ? styles.unread : null;

  const row = (
    <Pressable
      onPress={open}
      onLongPress={() => {
        swipeRef.current?.reset();
        Haptics.selectionAsync();
        onToggleSelect(thread.id);
      }}
      style={({ pressed }) => [styles.row, { backgroundColor: selected ? c.fill : pressed ? c.fill : c.background }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${thread.unread ? 'Unread. ' : ''}${showSent ? sentLine(thread) : participants(thread, me)}. ${thread.subject}. ${snippet(last.body)}`}
      accessibilityHint={selecting ? 'Toggles selection' : 'Opens the conversation'}
    >
      {state.settings.showAvatars || selecting ? (
        <Pressable onPress={() => onToggleSelect(thread.id)} hitSlop={6} accessibilityLabel={selected ? 'Deselect' : 'Select'}>
          <Avatar name={avatarPerson.name} address={avatarPerson.address} selected={selected} />
        </Pressable>
      ) : null}

      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={[styles.from, { color: c.label }, weight]} numberOfLines={1}>
            {showSent ? sentLine(thread) : participants(thread, me)}
          </Text>
          {thread.important ? <Icon ios="flag.fill" android="label_important" size={12} color={c.orange} /> : null}
          <Text style={[styles.time, { color: thread.unread ? c.label : c.secondaryLabel }, weight]}>
            {thread.scheduledAt ? `Sends ${listTime(time)}` : listTime(time)}
          </Text>
        </View>

        <View style={styles.line}>
          <Text style={[styles.subject, { color: c.label }, weight]} numberOfLines={1}>
            {thread.subject || '(no subject)'}
          </Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setStarred([thread.id], !thread.starred);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={thread.starred ? 'Unstar' : 'Star'}
          >
            <Icon
              ios={thread.starred ? 'star.fill' : 'star'}
              android="star"
              size={18}
              color={thread.starred ? c.yellow : c.tertiaryLabel}
            />
          </Pressable>
        </View>

        <View style={styles.line}>
          <Text style={[styles.snippet, { color: c.secondaryLabel }]} numberOfLines={1}>
            {snippet(last.body)}
          </Text>
          {hasAttachment ? <Icon ios="paperclip" android="attach_file" size={14} color={c.secondaryLabel} /> : null}
        </View>

        {thread.labelIds.length > 0 ? (
          <View style={styles.labels}>
            {thread.labelIds.slice(0, 3).map((id) => {
              const label = state.labels.find((l) => l.id === id);
              if (!label) return null;
              return (
                <View key={id} style={[styles.chip, { borderColor: c.separator }]}>
                  <View style={[styles.dot, { backgroundColor: label.color }]} />
                  <Text style={[styles.chipText, { color: c.secondaryLabel }]}>{label.name}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </Pressable>
  );

  if (!swipe || (!leading && !trailing)) return <View style={{ backgroundColor: c.background }}>{row}</View>;

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={!selecting}
      childrenContainerStyle={{ backgroundColor: c.background }}
      containerStyle={{ backgroundColor: c.background }}
      dragOffsetFromLeft={Platform.OS === 'ios' ? 20 : 10}
      dragOffsetFromRight={Platform.OS === 'ios' ? -20 : -10}
      overshootLeft={Platform.OS === 'ios' ? false : undefined}
      overshootRight={Platform.OS === 'ios' ? false : undefined}
      friction={1.6}
      leftThreshold={90}
      rightThreshold={90}
      overshootFriction={8}
      renderLeftActions={leading ? (progress) => <SwipeReveal progress={progress}>{actionView(leading, 'flex-start')}</SwipeReveal> : undefined}
      renderRightActions={trailing ? (progress) => <SwipeReveal progress={progress}>{actionView(trailing, 'flex-end')}</SwipeReveal> : undefined}
      onSwipeableWillOpen={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
      onSwipeableOpen={(direction) => {
        if (selecting) return;
        // RIGHT means the row moved right, revealing the leading actions.
        run(direction === SwipeDirection.RIGHT ? state.settings.swipeLeading : state.settings.swipeTrailing);
      }}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

function SwipeReveal({ progress, children }: { progress: SharedValue<number>; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({ opacity: progress.get() > 0 ? 1 : 0 }));
  return <Animated.View style={[{ flexDirection: 'row' }, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  from: { flex: 1, fontSize: 16, fontWeight: '400' },
  time: { fontSize: 13, fontVariant: ['tabular-nums'] },
  subject: { flex: 1, fontSize: 15 },
  snippet: { flex: 1, fontSize: 15 },
  unread: { fontWeight: '700' },
  labels: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 12 },
  action: { width: 96, justifyContent: 'center' },
  actionInner: { alignItems: 'center', gap: 4, width: 96 },
  actionLabel: { fontSize: 12, fontWeight: '600' },
});
