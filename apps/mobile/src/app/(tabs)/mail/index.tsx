import { haptic } from '@/lib/haptics';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { HapticPressable as Pressable } from '@/components/haptic-pressable';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AccountMenu } from '@/components/account-switcher';
import { EmptyState } from '@/components/empty-state';
import { ThreadRow } from '@/components/thread-row';
import { listTime, snippet } from '@/mail/format';
import { FOLDERS, draftsForAccount, folderTitle, threadsIn, unreadCount } from '@/mail/selectors';
import {
  activeAccount,
  archive,
  deleteForever,
  emptyFolder,
  markRead,
  moveToInbox,
  reportSpam,
  setActiveAccount,
  setFolder,
  setStarred,
  trash,
  useMail,
} from '@/mail/store';
import type { Draft, FolderKey, Thread } from '@/mail/types';
import { useLiveMail } from '@/mail/use-live-mail';
import { useColors } from '@/theme/colors';
import { ToolbarIcon } from '@/theme/icons';

const isIOS = process.env.EXPO_OS === 'ios';

const EMPTY: Partial<Record<FolderKey, { title: string; message: string }>> = {
  inbox: { title: 'You are all caught up', message: 'New mail sent to your address appears here.' },
  starred: { title: 'No starred mail', message: 'Star a conversation to find it here quickly.' },
  snoozed: { title: 'Nothing snoozed', message: 'Snoozed mail comes back to your inbox at the time you pick.' },
  important: { title: 'Nothing marked important', message: 'Mark a conversation important from its More menu.' },
  sent: { title: 'No sent mail', message: 'Mail you send from this address appears here.' },
  scheduled: { title: 'Nothing scheduled', message: 'Choose Schedule send in a new message to send it later.' },
  drafts: { title: 'No drafts', message: 'Messages you start and close without sending are saved here.' },
  all: { title: 'No mail yet', message: 'All your mail, except Spam and Trash, appears here.' },
  spam: { title: 'No spam', message: 'Mail you report as spam appears here.' },
  trash: { title: 'Trash is empty', message: 'Deleted mail stays here until you empty the Trash.' },
};

export default function MailList() {
  const state = useMail();
  const c = useColors();
  const [selected, setSelected] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sampleUpdatedAt, setSampleUpdatedAt] = useState(() => new Date());
  const liveMail = useLiveMail();
  const updatedAt = liveMail.live ? liveMail.updatedAt : sampleUpdatedAt;

  const folder = state.folder;
  const account = activeAccount(state);
  const title = folderTitle(state, folder);
  const selecting = selected.length > 0;

  const threads = useMemo(() => {
    const list = threadsIn(state, folder);
    if (state.settings.conversationView) return list;
    // With conversation view off, every message is its own row.
    return list.flatMap((t) =>
      t.messages.map((m): Thread & { openId: string } => ({ ...t, id: `${t.id}:${m.id}`, openId: t.id, messages: [m] })),
    );
  }, [state, folder]);

  const drafts = useMemo(() => (folder === 'drafts' ? draftsForAccount(state) : []), [state, folder]);

  const realIds = (ids: string[]) => Array.from(new Set(ids.map((id) => id.split(':')[0]!)));
  const selectedThreads = state.threads.filter((t) => realIds(selected).includes(t.id));
  const anyUnread = selectedThreads.some((t) => t.unread);
  const allStarred = selectedThreads.length > 0 && selectedThreads.every((t) => t.starred);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const finish = (fn: (ids: string[]) => void) => {
    fn(realIds(selected));
    setSelected([]);
  };

  const refresh = () => {
    setRefreshing(true);
    if (liveMail.live) {
      void liveMail.refresh().finally(() => setRefreshing(false));
      return;
    }
    // Sample mailboxes have nothing to fetch; this keeps the gesture honest about when it last ran.
    setTimeout(() => {
      setSampleUpdatedAt(new Date());
      setRefreshing(false);
    }, 600);
  };

  const inTrash = folder === 'trash';
  const inSpam = folder === 'spam';

  return (
    <>
      <Stack.Screen options={{ title: selecting ? `${selected.length} selected` : title }} />

      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon={ToolbarIcon.menu} hidden={selecting || isIOS} accessibilityLabel="Folders and mailboxes" onPress={() => { haptic(); return (() => router.push('/folders'))(); }} />
        <Stack.Toolbar.Menu icon={ToolbarIcon.menu} hidden={selecting || !isIOS} accessibilityLabel="Folders">
          <Stack.Toolbar.Menu inline title={account.address}>
            {FOLDERS.map((f) => {
              const count = f.id === 'drafts' ? draftsForAccount(state).length : unreadCount(state, f.id);
              return (
                <Stack.Toolbar.MenuAction
                  key={f.id}
                  icon={isIOS ? f.ios : undefined}
                  isOn={folder === f.id}
                  onPress={() => { haptic(); return (() => setFolder(f.id))(); }}
                >
                  {count > 0 ? `${f.title} · ${count}` : f.title}
                </Stack.Toolbar.MenuAction>
              );
            })}
          </Stack.Toolbar.Menu>
          {state.labels.length > 0 ? (
            <Stack.Toolbar.Menu inline title="Labels">
              {state.labels.map((l) => (
                <Stack.Toolbar.MenuAction
                  key={l.id}
                  icon={isIOS ? 'tag' : undefined}
                  isOn={folder === `label:${l.id}`}
                  onPress={() => { haptic(); return (() => setFolder(`label:${l.id}`))(); }}
                >
                  {l.name}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          ) : null}
          {state.accounts.length > 1 ? (
            <Stack.Toolbar.Menu title="Switch mailbox" icon={isIOS ? 'person.2' : undefined}>
              {state.accounts.map((a) => (
                <Stack.Toolbar.MenuAction
                  key={a.id}
                  isOn={a.id === state.activeAccountId}
                  subtitle={a.shared ? 'Shared mailbox' : undefined}
                  onPress={() => { haptic(); return (() => setActiveAccount(a.id))(); }}
                >
                  {a.address}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          ) : null}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button hidden={!selecting} onPress={() => { haptic(); return (() => setSelected([]))(); }}>
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <Stack.Toolbar placement="right">
        <Stack.Toolbar.View hidden={selecting} hidesSharedBackground><AccountMenu/></Stack.Toolbar.View>
        <Stack.Toolbar.Button
          hidden={selecting}
          icon={ToolbarIcon.compose}
          disabled={account.live && !account.canSend}
          accessibilityLabel="New message"
          onPress={() => { haptic(); return (() => router.push('/compose'))(); }}
        />
        <Stack.Toolbar.Button
          hidden={!selecting}
          onPress={() => { haptic(); return (() => setSelected(threads.map((t) => t.id)))(); }}
        >
          Select all
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      {selecting ? (
        <Stack.Toolbar>
          {inTrash || inSpam ? (
            <Stack.Toolbar.Button icon={ToolbarIcon.unarchive} accessibilityLabel="Move to Inbox" onPress={() => { haptic(); return (() => finish(moveToInbox))(); }} />
          ) : (
            <Stack.Toolbar.Button icon={ToolbarIcon.archive} accessibilityLabel="Archive" onPress={() => { haptic(); return (() => finish(archive))(); }} />
          )}
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button
            icon={ToolbarIcon.trash}
            accessibilityLabel={inTrash ? 'Delete forever' : 'Move to Trash'}
            onPress={() => { haptic(); return (() => finish(inTrash ? deleteForever : trash))(); }}
          />
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button
            icon={ToolbarIcon.unread}
            accessibilityLabel={anyUnread ? 'Mark as read' : 'Mark as unread'}
            onPress={() => { haptic(); return (() => finish((ids) => markRead(ids, anyUnread)))(); }}
          />
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Menu icon={ToolbarIcon.more} accessibilityLabel="More actions">
            <Stack.Toolbar.MenuAction icon={isIOS ? (allStarred ? 'star.slash' : 'star') : undefined} onPress={() => { haptic(); return (() => finish((ids) => setStarred(ids, !allStarred)))(); }}>
              {allStarred ? 'Remove star' : 'Add star'}
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon={isIOS ? 'clock' : undefined}
              onPress={() => { haptic(); return (() => {
                const ids = realIds(selected);
                setSelected([]);
                router.push({ pathname: '/snooze', params: { ids: ids.join(',') } });
              })(); }}
            >
              Snooze
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon={isIOS ? 'folder' : undefined}
              onPress={() => { haptic(); return (() => {
                const ids = realIds(selected);
                setSelected([]);
                router.push({ pathname: '/organize', params: { ids: ids.join(',') } });
              })(); }}
            >
              Move and label
            </Stack.Toolbar.MenuAction>
            {!inSpam ? (
              <Stack.Toolbar.MenuAction icon={isIOS ? 'exclamationmark.octagon' : undefined} destructive onPress={() => { haptic(); return (() => finish(reportSpam))(); }}>
                Report spam
              </Stack.Toolbar.MenuAction>
            ) : null}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}

      {folder === 'drafts' ? (
        <FlatList
          data={drafts}
          keyExtractor={(d) => d.id}
          contentInsetAdjustmentBehavior="automatic"
          style={{ backgroundColor: c.background }}
          renderItem={({ item }) => <DraftRow draft={item} />}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.separator, marginLeft: 16 }]} />}
          ListEmptyComponent={<EmptyState ios="doc" android="draft" {...EMPTY.drafts!} />}
        />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.id}
          contentInsetAdjustmentBehavior="automatic"
          style={{ backgroundColor: c.background }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          renderItem={({ item }) => (
            <ThreadRow
              thread={item}
              state={state}
              selecting={selecting}
              selected={selected.includes(item.id)}
              onToggleSelect={toggle}
              openId={(item as Thread & { openId?: string }).openId}
            />
          )}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.separator, marginLeft: state.settings.showAvatars ? 68 : 16 }]} />}
          ListHeaderComponent={
            liveMail.error ? (
              <View style={[styles.banner, { backgroundColor: c.fill }]} accessibilityLiveRegion="polite">
                <Text style={[styles.bannerText, { color: c.secondaryLabel }]}>{liveMail.error}</Text>
                <Pressable onPress={refresh} hitSlop={8} accessibilityRole="button">
                  <Text style={[styles.bannerAction, { color: c.tint }]}>Try again</Text>
                </Pressable>
              </View>
            ) : inTrash || inSpam ? (
              <View style={[styles.banner, { backgroundColor: c.fill }]}>
                <Text style={[styles.bannerText, { color: c.secondaryLabel }]}>
                  {inTrash ? 'Mail in Trash stays here until you empty it.' : 'Spam stays here until you empty it.'}
                </Text>
                {threads.length > 0 ? (
                  <Pressable onPress={() => emptyFolder(inTrash ? 'trash' : 'spam')} hitSlop={8} accessibilityRole="button">
                    <Text style={[styles.bannerAction, { color: c.red }]}>{inTrash ? 'Empty Trash' : 'Empty Spam'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : undefined
          }
          ListFooterComponent={
            threads.length > 0 && updatedAt ? (
              <Text style={[styles.updated, { color: c.tertiaryLabel }]}>
                Updated {updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </Text>
            ) : undefined
          }
          ListEmptyComponent={(() => {
            const meta = FOLDERS.find((f) => f.id === folder);
            const copy = EMPTY[folder] ?? { title: `No mail labelled ${title}`, message: 'Add this label to a conversation from its More menu.' };
            return <EmptyState ios={meta?.ios ?? 'tag'} android={(meta?.android ?? 'label') as never} {...(account.unavailable ? {title:'No mailbox access',message:'An admin can assign a mailbox in Settings → Manage mailboxes.'} : copy)} />;
          })()}
        />
      )}
    </>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/compose', params: { draftId: draft.id } })}
      style={({ pressed }) => [styles.draft, { backgroundColor: pressed ? c.fill : c.background }]}
      accessibilityRole="button"
    >
      <View style={styles.draftLine}>
        <Text style={[styles.draftLabel, { color: c.red }]}>Draft</Text>
        <Text style={[styles.draftTo, { color: c.label }]} numberOfLines={1}>
          {draft.to || 'No recipients'}
        </Text>
        <Text style={[styles.draftTime, { color: c.secondaryLabel }]}>{listTime(draft.updatedAt)}</Text>
      </View>
      <Text style={[styles.draftSubject, { color: c.label }]} numberOfLines={1}>
        {draft.subject || '(no subject)'}
      </Text>
      <Text style={{ color: c.secondaryLabel, fontSize: 15 }} numberOfLines={1}>
        {snippet(draft.body) || 'No content'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth },
  banner: { margin: 16, marginBottom: 8, padding: 14, borderRadius: 12, gap: 8 },
  bannerText: { fontSize: 14, lineHeight: 19 },
  bannerAction: { fontSize: 15, fontWeight: '600' },
  updated: { textAlign: 'center', fontSize: 12, paddingVertical: 20 },
  draft: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
  draftLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  draftLabel: { fontSize: 15, fontWeight: '600' },
  draftTo: { flex: 1, fontSize: 16 },
  draftTime: { fontSize: 13 },
  draftSubject: { fontSize: 15 },
});
