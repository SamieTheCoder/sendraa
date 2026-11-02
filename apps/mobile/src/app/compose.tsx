import * as DocumentPicker from 'expo-document-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActionSheetIOS, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TextBox } from '@/components/form';
import { Icon } from '@/components/icon';
import { fileSize, parseAddresses, replaceTrailingToken, trailingToken } from '@/mail/format';
import { contacts } from '@/mail/selectors';
import {
  deleteDraft,
  discardDraft,
  draftFor,
  draftHasContent,
  emptyDraft,
  getMail,
  saveDraft,
  send,
  signatureBlock,
  useMail,
} from '@/mail/store';
import type { Draft } from '@/mail/types';
import { useColors } from '@/theme/colors';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ToolbarIcon } from '@/theme/icons';

const isIOS = process.env.EXPO_OS === 'ios';
const MAX_BYTES = 25 * 1024 * 1024;

type Field = 'to' | 'cc' | 'bcc';

function initialDraft(params: { draftId?: string; threadId?: string; mode?: string }): Draft {
  const state = getMail();
  if (params.draftId) {
    const existing = state.drafts.find((d) => d.id === params.draftId);
    if (existing) return existing;
  }
  if (params.threadId && (params.mode === 'reply' || params.mode === 'replyAll' || params.mode === 'forward')) {
    return draftFor(params.threadId, params.mode);
  }
  return emptyDraft({ body: signatureBlock(state.activeAccountId) });
}

function at(daysFromNow: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function nextMonday(hour: number): Date {
  const d = new Date();
  const add = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + add);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export default function Compose() {
  const params = useLocalSearchParams<{ draftId?: string; threadId?: string; mode?: string }>();
  const state = useMail();
  const c = useColors();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(params));
  const [showCc, setShowCc] = useState(() => Boolean(draft.cc || draft.bcc));
  const [focused, setFocused] = useState<Field | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(Boolean(params.draftId));
  const finished = useRef(false);
  const bodyRef = useRef<ComponentRef<typeof TextInput>>(null);

  const account = state.accounts.find((a) => a.id === draft.accountId) ?? state.accounts[0]!;
  const people = useMemo(() => contacts(state), [state]);

  // Autosave like Gmail: once the user has typed anything, the draft is kept
  // even if the sheet is swiped away.
  useEffect(() => {
    if (!dirty.current || finished.current) return;
    const timer = setTimeout(() => {
      if (!finished.current && draftHasContent(draft)) saveDraft(draft);
    }, 400);
    return () => clearTimeout(timer);
  }, [draft]);

  const update = (patch: Partial<Draft>) => {
    dirty.current = true;
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const suggestions = useMemo(() => {
    if (!focused) return [];
    const token = trailingToken(draft[focused]).toLowerCase();
    if (token.length < 1) return [];
    const already = new Set(parseAddresses(draft[focused]).map((a) => a.address.toLowerCase()));
    return people
      .filter((p) => !already.has(p.address.toLowerCase()))
      .filter((p) => p.address.toLowerCase().includes(token) || p.name.toLowerCase().includes(token))
      .slice(0, 5);
  }, [focused, draft, people]);

  const switchAccount = (accountId: string) => {
    const oldSig = signatureBlock(draft.accountId);
    const newSig = signatureBlock(accountId);
    const body = oldSig && draft.body.includes(oldSig) ? draft.body.replace(oldSig, newSig) : draft.body;
    update({ accountId, body });
  };

  const pickFrom = () => {
    const options = state.accounts.map((a) => a.address);
    if (isIOS) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Send from', options: [...options, 'Cancel'], cancelButtonIndex: options.length },
        (i) => {
          if (i < options.length) switchAccount(state.accounts[i]!.id);
        },
      );
    } else {
      Alert.alert('Send from', undefined, [
        ...state.accounts.map((a) => ({ text: a.address, onPress: () => switchAccount(a.id) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const attach = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: false });
    if (result.canceled) return;
    const added = result.assets.map((a) => ({
      id: `${a.uri}-${a.name}`,
      name: a.name,
      size: a.size ?? 0,
      type: a.mimeType ?? 'application/octet-stream',
    }));
    const total = [...draft.attachments, ...added].reduce((n, a) => n + a.size, 0);
    if (total > MAX_BYTES) {
      Alert.alert('Attachments are too large', `A message can carry up to 25 MB. These files add up to ${fileSize(total)}.`);
      return;
    }
    update({ attachments: [...draft.attachments, ...added] });
  };

  const doSend = (scheduledAt?: Date) => {
    const result = send(draft, {
      scheduledAt,
      reopen: (draftId) => router.push({ pathname: '/compose', params: { draftId } }),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finished.current = true;
    router.back();
  };

  const confirmAndSend = (scheduledAt?: Date) => {
    if (!draft.subject.trim() && parseAddresses(`${draft.to},${draft.cc},${draft.bcc}`).length > 0) {
      Alert.alert('Send without a subject?', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => doSend(scheduledAt) },
      ]);
      return;
    }
    doSend(scheduledAt);
  };

  const close = () => {
    const hasContent = dirty.current && draftHasContent(draft);
    if (!hasContent) {
      finished.current = true;
      deleteDraft(draft.id);
      router.back();
      return;
    }
    const keep = () => {
      finished.current = true;
      saveDraft(draft);
      router.back();
    };
    const drop = () => {
      finished.current = true;
      discardDraft(draft.id);
      router.back();
    };
    if (isIOS) {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Delete Draft', 'Save Draft', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 2 },
        (i) => {
          if (i === 0) drop();
          if (i === 1) keep();
        },
      );
    } else {
      Alert.alert('Save this draft?', undefined, [
        { text: 'Delete', style: 'destructive', onPress: drop },
        { text: 'Save', onPress: keep },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const titles = { new: 'New message', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' } as const;

  const renderField = (field: Field, label: string) => (
    <>
      <View style={[styles.field, { borderBottomColor: c.separator }]}>
        <Text style={[styles.label, { color: c.secondaryLabel }]}>{label}</Text>
        <TextBox
          value={draft[field]}
          onChangeText={(v) => update({ [field]: v })}
          onFocus={() => setFocused(field)}
          onBlur={() => setFocused((f) => (f === field ? null : f))}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          autoFocus={field === 'to' && !draft.to && draft.mode !== 'reply' && draft.mode !== 'replyAll'}
          boxStyle={{ flex: 1 }}
          placeholderTextColor={c.secondaryLabel}
          selectionColor={c.tint}
          cursorColor={c.tint}
          accessibilityLabel={label}
          returnKeyType="next"
        />
        {field === 'to' && !showCc ? (
          <Pressable onPress={() => setShowCc(true)} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: c.tint, fontSize: 15 }}>Cc/Bcc</Text>
          </Pressable>
        ) : null}
      </View>
      {focused === field && suggestions.length > 0 ? (
        <View style={[styles.suggestions, { backgroundColor: c.cell, borderBottomColor: c.separator }]}>
          {suggestions.map((p) => (
            <Pressable
              key={p.address}
              onPress={() => update({ [field]: replaceTrailingToken(draft[field], p.address) })}
              style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: c.fill }]}
              accessibilityRole="button"
              accessibilityLabel={`Add ${p.name || p.address}`}
            >
              <Text style={{ color: c.label, fontSize: 15 }} numberOfLines={1}>
                {p.name || p.address}
              </Text>
              {p.name ? (
                <Text style={{ color: c.secondaryLabel, fontSize: 13 }} numberOfLines={1}>
                  {p.address}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );

  return (
    <>
      <Stack.Screen options={{ title: titles[draft.mode] }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon={ToolbarIcon.close} accessibilityLabel="Close" onPress={close} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={ToolbarIcon.attach} accessibilityLabel="Attach files" onPress={attach} />
        <Stack.Toolbar.Menu icon={ToolbarIcon.snooze} accessibilityLabel="Schedule send">
          <Stack.Toolbar.Menu inline title="Schedule send">
            <Stack.Toolbar.MenuAction icon={isIOS ? 'sunrise' : undefined} onPress={() => confirmAndSend(at(1, 8))}>
              Tomorrow morning, 8:00
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon={isIOS ? 'sun.max' : undefined} onPress={() => confirmAndSend(at(1, 13))}>
              Tomorrow afternoon, 1:00
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon={isIOS ? 'calendar' : undefined} onPress={() => confirmAndSend(nextMonday(8))}>
              Monday morning, 8:00
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon={ToolbarIcon.send} variant="prominent" accessibilityLabel="Send" onPress={() => confirmAndSend()} />
      </Stack.Toolbar>

      <KeyboardAwareScrollView
        bottomOffset={24}
        style={{ backgroundColor: c.background }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentInsetAdjustmentBehavior="automatic"
      >
        {state.accounts.length > 1 ? (
          <Pressable onPress={pickFrom} style={[styles.field, { borderBottomColor: c.separator }]} accessibilityRole="button" accessibilityLabel={`From ${account.address}. Change`}>
            <Text style={[styles.label, { color: c.secondaryLabel }]}>From</Text>
            <Text style={[styles.input, { color: c.label }]} numberOfLines={1}>
              {account.address}
            </Text>
            <Icon ios="chevron.up.chevron.down" android="unfold_more" size={14} color={c.tertiaryLabel} />
          </Pressable>
        ) : null}

        {renderField('to', 'To')}
        {error ? <Text style={[styles.error, { color: c.red }]}>{error}</Text> : null}
        {showCc ? renderField('cc', 'Cc') : null}
        {showCc ? renderField('bcc', 'Bcc') : null}

        <View style={[styles.field, { borderBottomColor: c.separator }]}>
          <TextBox
            value={draft.subject}
            onChangeText={(subject) => update({ subject })}
            placeholder="Subject"
            placeholderTextColor={c.secondaryLabel}
          selectionColor={c.tint}
          cursorColor={c.tint}
            boxStyle={{ flex: 1 }}
            returnKeyType="next"
            onSubmitEditing={() => bodyRef.current?.focus()}
            accessibilityLabel="Subject"
          />
        </View>

        {draft.attachments.length > 0 ? (
          <View style={styles.attachments}>
            {draft.attachments.map((a) => (
              <View key={a.id} style={[styles.attachment, { borderColor: c.separator }]}>
                <Icon ios="doc.fill" android="description" size={18} color={c.tint} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.label, fontSize: 14 }} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={{ color: c.secondaryLabel, fontSize: 12 }}>{fileSize(a.size)}</Text>
                </View>
                <Pressable
                  onPress={() => update({ attachments: draft.attachments.filter((x) => x.id !== a.id) })}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${a.name}`}
                >
                  <Icon ios="xmark.circle.fill" android="cancel" size={18} color={c.tertiaryLabel} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <TextBox
          ref={bodyRef}
          value={draft.body}
          onChangeText={(body) => update({ body })}
          placeholder="Compose email"
          placeholderTextColor={c.secondaryLabel}
          selectionColor={c.tint}
          cursorColor={c.tint}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          autoFocus={draft.mode === 'reply' || draft.mode === 'replyAll'}
          boxStyle={{ margin: 16 }}
          style={[styles.body, { color: c.label }]}
          accessibilityLabel="Message"
        />
      </KeyboardAwareScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 16, paddingTop: 12 },
  label: { fontSize: 16, width: 44 },
  input: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, paddingVertical: 12 },
  error: { fontSize: 14, paddingHorizontal: 16, paddingVertical: 8 },
  suggestions: { borderBottomWidth: StyleSheet.hairlineWidth },
  suggestion: { paddingHorizontal: 16, paddingLeft: 68, paddingVertical: 10 },
  attachments: { padding: 16, paddingBottom: 0, gap: 8 },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10 },
  body: { fontSize: 16, lineHeight: 23, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, minHeight: 320 },
});
