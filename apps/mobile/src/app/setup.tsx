import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { getMe, loadMe, useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

type Step = { id: string; title: string; status: 'pending' | 'running' | 'done' | 'failed'; error: string | null };
type Setup = {
  status: 'not_started' | 'running' | 'ready' | 'failed';
  error: string | null;
  cloudflareAccount: string | null;
  cloudflareAccountId: string | null;
  domain: { name: string } | null;
  steps: Step[];
};
type Zone = { id: string; name: string; status: string; accountId: string | null };

/**
 * F2 + F3 in the app: pick a domain, then watch Sendraa build the mail system
 * in the admin's own Cloudflare account. The work runs on the server, so the
 * admin can leave this screen and come back.
 */
export default function SetupScreen() {
  const c = useColors();
  const workspace = useActiveWorkspace();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const lastStatus = useRef<string | null>(null);
  const tid = workspace?.id;

  const refresh = useCallback(async () => {
    if (!tid) return;
    try {
      const s = await api<Setup>(`/v1/tenants/${tid}/setup`);
      setSetup(s);
      if (lastStatus.current === 'running' && s.status !== 'running') {
        void Haptics.notificationAsync(s.status === 'ready' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
        const me = getMe();
        if (me) void loadMe(me.user.id);
      }
      lastStatus.current = s.status;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read setup progress.');
    }
  }, [tid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while the server is working, and whenever the app comes back to the foreground.
  useEffect(() => {
    if (setup?.status !== 'running') return;
    const t = setInterval(refresh, 1500);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [setup?.status, refresh]);

  // Domain choices, only needed before a domain is connected.
  useEffect(() => {
    if (!setup || setup.domain) return;
    api<{ zones: Zone[] }>(`/v1/cloudflare/zones?accountId=${setup.cloudflareAccountId ?? ''}`)
      .then(({ zones: z }) => {
        setZones(z);
        const active = z.filter((x) => x.status === 'active');
        if (active.length === 1) setZoneId(active[0]!.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read your domains.'));
  }, [setup]);

  const start = async () => {
    if (!tid) return;
    setStarting(true);
    setError(null);
    try {
      await api(`/v1/tenants/${tid}/setup`, { method: 'POST', body: zoneId && !setup?.domain ? { zoneId } : {} });
      lastStatus.current = 'running';
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup.');
    } finally {
      setStarting(false);
    }
  };

  if (!setup) {
    return (
      <View style={[styles.center, { backgroundColor: c.groupedBackground }]}>
        <Stack.Screen options={{ title: 'Email setup' }} />
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator />}
      </View>
    );
  }

  const ready = setup.status === 'ready';
  const running = setup.status === 'running' || starting;
  const domainName = setup.domain?.name ?? zones?.find((z) => z.id === zoneId)?.name;

  return (
    <ScrollView style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={styles.wrap} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: 'Email setup' }} />

      <View style={styles.intro}>
        <Text style={[styles.title, { color: c.label }]} accessibilityRole="header">
          {ready ? `${domainName} is ready` : domainName ? `Email for ${domainName}` : 'Choose your domain'}
        </Text>
        <Text style={[styles.body, { color: c.secondaryLabel }]}>
          {ready
            ? `Mail sent to admin@${domainName} now arrives in Sendraa. Everything runs in ${setup.cloudflareAccount ?? 'your Cloudflare account'}.`
            : `Sendraa creates a database, storage and a small Worker in ${setup.cloudflareAccount ?? 'your Cloudflare account'}, then turns on Email Routing. All on Cloudflare’s free plan.`}
        </Text>
      </View>

      {!setup.domain ? (
        <View style={styles.block}>
          <Text style={[styles.heading, { color: c.secondaryLabel }]}>Domain</Text>
          {zones === null ? (
            <ActivityIndicator style={styles.spinner} />
          ) : zones.length === 0 ? (
            <Text style={[styles.caption, { color: c.secondaryLabel }]}>This Cloudflare account has no domains. Add one in Cloudflare, then come back.</Text>
          ) : (
            <View style={[styles.group, { backgroundColor: c.cell }]}>
              {zones.map((z, i) => {
                const usable = z.status === 'active';
                return (
                  <Pressable
                    key={z.id}
                    disabled={!usable || running}
                    onPress={() => setZoneId(z.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: z.id === zoneId, disabled: !usable }}
                    style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.rowText, { color: usable ? c.label : c.tertiaryLabel }]} numberOfLines={1}>{z.name}</Text>
                    {!usable ? <Text style={[styles.badge, { color: c.tertiaryLabel }]}>{z.status}</Text> : null}
                    {z.id === zoneId ? <Icon ios="checkmark" android="check" size={17} color={c.tint} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          <Text style={[styles.caption, { color: c.tertiaryLabel }]}>
            Existing DNS records and email rules stay as they are. If the domain already receives mail elsewhere, setup stops and tells you.
          </Text>
        </View>
      ) : null}

      {setup.status !== 'not_started' || setup.domain ? (
        <View style={[styles.group, { backgroundColor: c.cell }]} accessibilityLiveRegion="polite">
          {setup.steps.map((s, i) => (
            <View key={s.id} style={[styles.stepRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }]}>
              <StepIcon status={s.status} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepText, { color: s.status === 'pending' ? c.secondaryLabel : c.label }]}>{s.title}</Text>
                {s.error ? <Text style={[styles.stepError, { color: c.red }]}>{s.error}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {ready ? (
        <Button variant="brand" title="Open inbox" onPress={() => router.replace('/mail')} />
      ) : (
        <Button
          variant="brand"
          title={setup.status === 'failed' ? 'Try again' : running ? 'Setting up…' : 'Set up email'}
          onPress={start}
          loading={running}
          disabled={running || (!setup.domain && !zoneId)}
        />
      )}
      {!ready && !running ? <Button variant="plain" title="Later" onPress={() => router.replace('/mail')} /> : null}
    </ScrollView>
  );
}

function StepIcon({ status }: { status: Step['status'] }) {
  const c = useColors();
  if (status === 'running') return <ActivityIndicator style={styles.stepIcon} />;
  if (status === 'done') return <Icon ios="checkmark.circle.fill" android="check_circle" size={20} color={c.tint} />;
  if (status === 'failed') return <Icon ios="exclamationmark.triangle.fill" android="warning" size={20} color={c.red} />;
  return <Icon ios="circle" android="radio_button_unchecked" size={20} color={c.tertiaryLabel} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  wrap: { padding: 20, gap: 16, paddingBottom: 48 },
  intro: { gap: 8 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontSize: 16, lineHeight: 22 },
  block: { gap: 8 },
  heading: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 4 },
  group: { borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 46, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { fontSize: 17, flex: 1 },
  badge: { fontSize: 13 },
  caption: { fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
  spinner: { alignSelf: 'flex-start', marginLeft: 6, marginVertical: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  stepIcon: { width: 20, height: 20 },
  stepText: { fontSize: 16, lineHeight: 21 },
  stepError: { fontSize: 14, lineHeight: 19, marginTop: 4 },
});
