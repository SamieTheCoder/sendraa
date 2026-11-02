import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { displayName, fileSize, formatAddress, fullTime, listTime, snippet } from '@/mail/format';
import {
  archive,
  cancelScheduled,
  deleteForever,
  markRead,
  moveToInbox,
  reportSpam,
  setImportant,
  setStarred,
  trash,
  unsnooze,
  useMail,
} from '@/mail/store';
import { loadThread } from '@/mail/live';
import type { Message } from '@/mail/types';
import { useColors } from '@/theme/colors';
import { ToolbarIcon } from '@/theme/icons';

const isIOS = process.env.EXPO_OS === 'ios';

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useMail();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const thread = state.threads.find((t) => t.id === id);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const t = state.threads.find((x) => x.id === id);
    return new Set(t ? [t.messages[t.messages.length - 1]!.id] : []);
  });

  // Opening a conversation marks it read, as every mail app does.
  useEffect(() => {
    if (thread?.unread) markRead([thread.id], true);
  }, [thread?.id, thread?.unread]);

  // Server conversations arrive as a summary; fetch the messages on open.
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!thread?.remote || thread.remote.loaded) return;
    loadThread(thread.id).catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load this conversation.'));
  }, [thread?.id, thread?.remote]);

  // The newest message is already expanded by the row expression below.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!thread) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState ios="tray" android="inbox" title="Conversation not found" message="It may have been deleted or moved to another mailbox." />
      </>
    );
  }

  const account = state.accounts.find((a) => a.id === thread.accountId);
  const me = account?.address.toLowerCase() ?? '';
  const ids = [thread.id];
  const close = (fn: (ids: string[]) => void) => () => {
    fn(ids);
    router.back();
  };
  const last = thread.messages[thread.messages.length - 1]!;
  const recipients = new Set([last.from, ...last.to, ...last.cc].map((a) => a.address.toLowerCase()).filter((a) => a !== me));
  const canReplyAll = recipients.size > 1;
  const isSnoozed = thread.snoozedUntil !== null && new Date(thread.snoozedUntil).getTime() > now;
  const scheduled = thread.location === 'scheduled';

  const reply = (mode: 'reply' | 'replyAll' | 'forward') =>
    router.push({ pathname: '/compose', params: { threadId: thread.id, mode } });

  return (
    <>
      <Stack.Screen options={{ title: '' }} />

      <Stack.Toolbar placement="right">
        {thread.location === 'inbox' ? (
          <Stack.Toolbar.Button icon={ToolbarIcon.archive} accessibilityLabel="Archive" onPress={close(archive)} />
        ) : !scheduled ? (
          <Stack.Toolbar.Button icon={ToolbarIcon.unarchive} accessibilityLabel="Move to Inbox" onPress={close(moveToInbox)} />
        ) : null}
        <Stack.Toolbar.Button
          icon={ToolbarIcon.trash}
          accessibilityLabel={thread.location === 'trash' ? 'Delete forever' : 'Move to Trash'}
          onPress={close(thread.location === 'trash' ? deleteForever : trash)}
        />
        <Stack.Toolbar.Button icon={ToolbarIcon.unread} accessibilityLabel="Mark as unread" onPress={close((x) => markRead(x, false))} />
        <Stack.Toolbar.Menu icon={ToolbarIcon.more} accessibilityLabel="More actions">
          {scheduled ? (
            <Stack.Toolbar.MenuAction
              icon={isIOS ? 'xmark.circle' : undefined}
              onPress={() => {
                router.back();
                cancelScheduled(thread.id, (draftId) => router.push({ pathname: '/compose', params: { draftId } }));
              }}
            >
              Cancel send
            </Stack.Toolbar.MenuAction>
          ) : null}
          <Stack.Toolbar.MenuAction icon={isIOS ? 'folder' : undefined} onPress={() => router.push({ pathname: '/organize', params: { ids: thread.id, close: '1' } })}>
            Move and label
          </Stack.Toolbar.MenuAction>
          {isSnoozed ? (
            <Stack.Toolbar.MenuAction icon={isIOS ? 'clock.arrow.circlepath' : undefined} onPress={() => unsnooze(ids)}>
              Unsnooze
            </Stack.Toolbar.MenuAction>
          ) : (
            <Stack.Toolbar.MenuAction icon={isIOS ? 'clock' : undefined} onPress={() => router.push({ pathname: '/snooze', params: { ids: thread.id, close: '1' } })}>
              Snooze
            </Stack.Toolbar.MenuAction>
          )}
          <Stack.Toolbar.MenuAction icon={isIOS ? (thread.important ? 'flag.slash' : 'flag') : undefined} onPress={() => setImportant(ids, !thread.important)}>
            {thread.important ? 'Mark not important' : 'Mark important'}
          </Stack.Toolbar.MenuAction>
          {thread.location === 'spam' ? (
            <Stack.Toolbar.MenuAction icon={isIOS ? 'checkmark.shield' : undefined} onPress={close(moveToInbox)}>
              Not spam
            </Stack.Toolbar.MenuAction>
          ) : (
            <Stack.Toolbar.MenuAction icon={isIOS ? 'exclamationmark.octagon' : undefined} destructive onPress={close(reportSpam)}>
              Report spam
            </Stack.Toolbar.MenuAction>
          )}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: c.background }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <View style={styles.head}>
          <Text style={[styles.subject, { color: c.label }]} selectable accessibilityRole="header">
            {thread.subject || '(no subject)'}
          </Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setStarred(ids, !thread.starred);
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={thread.starred ? 'Unstar' : 'Star'}
          >
            <Icon ios={thread.starred ? 'star.fill' : 'star'} android="star" size={22} color={thread.starred ? c.yellow : c.tertiaryLabel} />
          </Pressable>
        </View>

        <View style={styles.tags}>
          {thread.important ? <Tag text="Important" color={c.orange} /> : null}
          {scheduled && thread.scheduledAt ? <Tag text={`Sends ${fullTime(thread.scheduledAt)}`} color={c.tint} /> : null}
          {isSnoozed ? <Tag text={`Snoozed until ${fullTime(thread.snoozedUntil!)}`} color={c.orange} /> : null}
          {thread.labelIds.map((lid) => {
            const l = state.labels.find((x) => x.id === lid);
            return l ? <Tag key={lid} text={l.name} color={l.color} /> : null;
          })}
        </View>

        {loadError ? (
          <Text style={[styles.loadError, { color: c.red }]} accessibilityLiveRegion="polite">
            {loadError}
          </Text>
        ) : null}

        {thread.messages.map((m, i) => (
          <MessageView
            key={m.id}
            message={m}
            me={me}
            expanded={expanded.has(m.id) || i === thread.messages.length - 1}
            onToggle={() =>
              setExpanded((s) => {
                const next = new Set(s);
                if (next.has(m.id)) next.delete(m.id);
                else next.add(m.id);
                return next;
              })
            }
            onReply={() => reply(state.settings.defaultReply === 'replyAll' && canReplyAll ? 'replyAll' : 'reply')}
          />
        ))}

        {!scheduled ? (
          <View style={styles.actions}>
            <ReplyButton ios="arrowshape.turn.up.left" android="reply" label="Reply" onPress={() => reply('reply')} />
            {canReplyAll ? <ReplyButton ios="arrowshape.turn.up.left.2" android="reply_all" label="Reply all" onPress={() => reply('replyAll')} /> : null}
            <ReplyButton ios="arrowshape.turn.up.right" android="forward" label="Forward" onPress={() => reply('forward')} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function Tag({ text, color }: { text: string; color: ColorValue }) {
  const c = useColors();
  return (
    <View style={[styles.tag, { borderColor: c.separator }]}>
      <View style={[styles.tagDot, { backgroundColor: color }]} />
      <Text style={[styles.tagText, { color: c.secondaryLabel }]}>{text}</Text>
    </View>
  );
}

function MessageView({
  message,
  me,
  expanded,
  onToggle,
  onReply,
}: {
  message: Message;
  me: string;
  expanded: boolean;
  onToggle: () => void;
  onReply: () => void;
}) {
  const c = useColors();
  const [details, setDetails] = useState(false);
  const fromMe = message.from.address.toLowerCase() === me;
  const toLine = message.to.map((a) => (a.address.toLowerCase() === me ? 'me' : displayName(a))).join(', ');

  return (
    <View style={[styles.message, { borderTopColor: c.separator }]}>
      <Pressable onPress={onToggle} style={styles.messageHead} accessibilityRole="button" accessibilityState={{ expanded }}>
        <Avatar name={message.from.name} address={message.from.address} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.messageLine}>
            <Text style={[styles.sender, { color: c.label }]} numberOfLines={1}>
              {fromMe ? 'me' : displayName(message.from)}
            </Text>
            <Text style={[styles.date, { color: c.secondaryLabel }]}>{listTime(message.date)}</Text>
          </View>
          {expanded ? (
            <Pressable onPress={() => setDetails((d) => !d)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Show message details">
              <Text style={[styles.to, { color: c.secondaryLabel }]} numberOfLines={1}>
                to {toLine || 'undisclosed recipients'} {details ? '▴' : '▾'}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.to, { color: c.secondaryLabel }]} numberOfLines={1}>
              {snippet(message.body)}
            </Text>
          )}
        </View>
        {expanded ? (
          <Pressable onPress={onReply} hitSlop={10} accessibilityRole="button" accessibilityLabel="Reply">
            <Icon ios="arrowshape.turn.up.left" android="reply" size={18} color={c.secondaryLabel} />
          </Pressable>
        ) : null}
      </Pressable>

      {expanded && details ? (
        <View style={[styles.details, { backgroundColor: c.fill }]}>
          <DetailLine label="From" value={formatAddress(message.from)} />
          <DetailLine label="To" value={message.to.map(formatAddress).join(', ')} />
          {message.cc.length > 0 ? <DetailLine label="Cc" value={message.cc.map(formatAddress).join(', ')} /> : null}
          <DetailLine label="Date" value={fullTime(message.date)} />
        </View>
      ) : null}

      {expanded ? (
        <>
          <Text style={[styles.bodyText, { color: c.label }]} selectable>
            {message.body}
          </Text>
          {message.attachments.length > 0 ? (
            <View style={styles.attachments}>
              {message.attachments.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => Alert.alert(a.name, 'Opening attachments in the app comes in the next update.')}
                  style={({ pressed }) => [styles.attachment, { borderColor: c.separator, backgroundColor: pressed ? c.fill : 'transparent' }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Attachment ${a.name}, ${fileSize(a.size)}`}
                >
                  <Icon ios="doc.fill" android="description" size={22} color={c.tint} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.attachmentName, { color: c.label }]} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Text style={{ color: c.secondaryLabel, fontSize: 12 }}>{fileSize(a.size)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <Text style={{ color: c.secondaryLabel, fontSize: 13, lineHeight: 19 }} selectable>
      <Text style={{ color: c.label, fontWeight: '600' }}>{label} </Text>
      {value}
    </Text>
  );
}

function ReplyButton({ ios, android, label, onPress }: { ios: 'arrowshape.turn.up.left' | 'arrowshape.turn.up.left.2' | 'arrowshape.turn.up.right'; android: 'reply' | 'reply_all' | 'forward'; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.replyButton, { borderColor: c.separator, backgroundColor: pressed ? c.fill : 'transparent' }]}
      accessibilityRole="button"
    >
      <Icon ios={ios} android={android} size={16} color={c.label} />
      <Text style={[styles.replyLabel, { color: c.label }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadError: { fontSize: 14, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  subject: { flex: 1, fontSize: 24, fontWeight: '700', letterSpacing: -0.3, lineHeight: 30 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  tagText: { fontSize: 13 },
  message: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  messageHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  messageLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sender: { flex: 1, fontSize: 16, fontWeight: '600' },
  date: { fontSize: 13 },
  to: { fontSize: 14, marginTop: 1 },
  details: { borderRadius: 10, padding: 12, gap: 2 },
  bodyText: { fontSize: 16, lineHeight: 23 },
  attachments: { gap: 8 },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  attachmentName: { fontSize: 15, fontWeight: '500' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  replyButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, minHeight: 44 },
  replyLabel: { fontSize: 15, fontWeight: '600' },
});
