import { Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { getMe, loadMe } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

/** Shown to a signed-in person who is not in any workspace yet. */
export default function Onboarding() {
  const c = useColors();
  const me = getMe();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      setError('Enter a name for your workspace, such as your company name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/v1/tenants', { method: 'POST', body: { name: name.trim() } });
      if (me) await loadMe(me.user.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Welcome', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.wrap} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        {me?.canCreateWorkspace ? (
          <View style={styles.block}>
            <Text style={[styles.title, { color: c.label }]} accessibilityRole="header">
              Name your workspace
            </Text>
            <Text style={[styles.body, { color: c.secondaryLabel }]}>
              A workspace holds your domains, mailboxes and team. You will be its owner. Next you will connect a domain.
            </Text>
            <Field label="Workspace name" value={name} onChangeText={setName} placeholder="Northwind Labs" returnKeyType="go" onSubmitEditing={create} autoFocus />
            <ErrorText>{error}</ErrorText>
            <Button variant="brand" title="Create workspace" onPress={create} loading={busy} />
          </View>
        ) : (
          <View style={styles.block}>
            <Text style={[styles.title, { color: c.label }]} accessibilityRole="header">
              You are not in a workspace yet
            </Text>
            <Text style={[styles.body, { color: c.secondaryLabel }]}>
              Ask your workspace admin to invite {me?.user.email ?? 'you'}, then open the link in the invite email. Admins who want to set up a new workspace sign in with Cloudflare.
            </Text>
          </View>
        )}
        <Button variant="plain" title="Sign out" onPress={() => authClient.signOut()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 16 },
  block: { gap: 14 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontSize: 16, lineHeight: 22 },
});
