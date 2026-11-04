import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, ErrorText, Field, NoticeText } from '@/components/form';
import { Row, Section } from '@/components/grouped-list';
import { api } from '@/lib/api';
import { loadSendingSettings } from '@/lib/sending';
import { useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

type Mailbox = { id: string; address: string };

export default function Sending() {
  const c = useColors(); const workspace = useActiveWorkspace();
  const [provider, setProvider] = useState<'cloudflare' | 'gmail'>('cloudflare');
  const [user, setUser] = useState(''); const [password, setPassword] = useState('');
  const [aliases, setAliases] = useState<string[]>([]); const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [savedUser, setSavedUser] = useState<string | null>(null);
  const [defaultMailbox, setDefaultMailbox] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const canManage = workspace?.permissions.includes('sending.configure');
  useEffect(() => {
    if (!workspace || !canManage) return;
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    Promise.allSettled([
      loadSendingSettings(workspace.id, controller.signal),
      api<{ mailboxes: Mailbox[] }>(`/v1/tenants/${workspace.id}/mailboxes?manage=true`, { signal: controller.signal }),
    ]).then(([settings, boxes]) => {
      if (!alive) return;
      if (settings.status === 'fulfilled') {
        setLoaded(true);
        const config = settings.value.config;
        if (config) {
          setDefaultMailbox(config.default_mailbox_id); setProvider(config.provider); setUser(config.gmail_user ?? ''); setAliases(config.allowed_from);
          setSavedUser(config.provider === 'gmail' && config.hasPassword ? config.gmail_user : null);
          setNotice(config.provider === 'gmail' && config.allowed_from.length === 0
            ? 'Google credentials are saved. Enable a verified sender below when you are ready to send.'
            : `Sending is configured with ${config.provider === 'gmail' ? 'Gmail' : 'Cloudflare'}.`);
        }
      } else setError(settings.reason instanceof Error ? settings.reason.message : 'Could not load sending settings.');
      if (boxes.status === 'fulfilled') { setMailboxes(boxes.value.mailboxes); setMailboxError(null); }
      else setMailboxError('Could not load mailbox addresses. You can still save your Google credentials. Reopen this page to try loading addresses again.');
    }).finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [workspace, canManage, reload]);
  const keepsPassword = Boolean(savedUser && user.trim().toLowerCase() === savedUser.toLowerCase());
  const save = async () => {
    if (!workspace || busy || !loaded) return;
    setError(null); setNotice(null);
    const normalizedPassword = password.replace(/\s/g, '');
    if (provider === 'gmail') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.trim())) { setError('Enter the Google email address that owns the app password.'); return; }
      if (!normalizedPassword && !keepsPassword) { setError('Enter your 16-character Google app password. You can paste it with spaces.'); return; }
      if (normalizedPassword && !/^[a-zA-Z0-9]{16}$/.test(normalizedPassword)) { setError('The app password must contain 16 characters. Spaces are ignored.'); return; }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    setBusy(true); setError(null); setNotice(null);
    try {
      await api(`/v1/tenants/${workspace.id}/sending`, { method: 'PUT', signal: controller.signal, body: provider === 'cloudflare' ? { provider } : { provider, user: user.trim(), password: normalizedPassword || undefined, allowedFrom: aliases } });
      const saved = await loadSendingSettings(workspace.id,controller.signal);
      setDefaultMailbox(saved.config?.default_mailbox_id ?? null);
      setPassword('');
      setSavedUser(provider === 'gmail' ? user.trim().toLowerCase() : null);
      setNotice(provider === 'gmail' && aliases.length === 0
        ? 'Google credentials verified and saved. Next, select any mailbox addresses you have verified in Gmail. Sending stays off until an address is enabled.'
        : 'Saved. Sending is ready for your enabled mailboxes.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not configure sending.'); }
    finally { clearTimeout(timer); setBusy(false); }
  };
  const feedback = <><ErrorText>{error}</ErrorText><NoticeText>{notice}</NoticeText></>;
  const saveButton = <Button title={provider === 'gmail' ? 'Verify credentials and save' : 'Connect Cloudflare sending'} variant="brand" onPress={save} loading={busy} disabled={!loaded} />;
  return <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={{ paddingBottom: 48 }}>
    <Stack.Screen options={{ title: 'Sending' }} />
    <View style={{ padding: 20, gap: 8 }}><Text style={{ color: c.label, fontSize: 26, fontWeight: '700' }}>Send from your domain</Text><Text style={{ color: c.secondaryLabel, lineHeight: 22 }}>Choose how {workspace?.name ?? 'your workspace'} delivers email. Sent mail stays in your Cloudflare account.</Text></View>
    {!canManage ? <View style={{ padding: 20 }}><ErrorText>Only a workspace admin can configure sending.</ErrorText></View> : <>
      {!loaded ? <View style={{ padding: 20, gap: 12 }}>
        {error ? <><ErrorText>{error}</ErrorText><Button title="Retry loading settings" variant="outline" onPress={() => { setError(null); setReload((v) => v + 1); }} /></> : <><ActivityIndicator /><Text style={{ color: c.secondaryLabel }}>Loading sending settings…</Text></>}
      </View> : null}
      <Section title="Delivery provider">
        <Row title="Cloudflare" subtitle="Uses your connected account and verified domain" checked={provider === 'cloudflare'} onPress={busy || !loaded ? undefined : () => { setProvider('cloudflare'); setNotice(null); }} />
        <Row title="Gmail relay" subtitle="Requires a verified Gmail alias for every sender; Gmail may reveal the relay account" checked={provider === 'gmail'} onPress={busy || !loaded ? undefined : () => { setProvider('gmail'); setNotice(null); }} />
      </Section>
      {provider === 'cloudflare' ? <View style={{ padding: 20, gap: 12 }}>
        <Text style={{ color: c.secondaryLabel, lineHeight: 22 }}>Connect checks your account’s Email Sending access and registers your workspace domains. Cloudflare may require you to enable Email Sending and finish DNS verification first.</Text>
        <Button title="Open Cloudflare" variant="outline" onPress={() => void WebBrowser.openBrowserAsync('https://dash.cloudflare.com/')} />
      </View> : <>
        <View style={{ padding: 20, gap: 18 }}>
          <Text style={{color:c.secondaryLabel,lineHeight:22}}>Connect one Gmail account for this workspace. The admin verifies each sender in Gmail; members use their work mailboxes without entering SMTP credentials. Google’s sending limits apply to the shared relay account.</Text>
          <Text style={{color:c.label,lineHeight:22}}>Your Google login authenticates the relay. Each message uses its mailbox’s address as From and Reply-To. If recipients see your Gmail address, configure and verify that exact address in Gmail’s Send mail as settings. Selecting it here alone cannot verify it with Google.</Text>
          <Button title="Open Gmail sender settings" variant="outline" onPress={()=>void WebBrowser.openBrowserAsync(`https://mail.google.com/mail/?authuser=${encodeURIComponent(user.trim())}#settings/accounts`)}/>
          <Field label="Google email" placeholder="you@gmail.com" value={user} onChangeText={setUser} autoCapitalize="none" keyboardType="email-address" editable={!busy && loaded} />
          <Field label="App password" placeholder={keepsPassword ? 'Saved securely — leave blank to keep' : 'Paste your 16-character app password'} value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!busy && loaded} textContentType="none" />
          <Text style={{ color: c.secondaryLabel, lineHeight: 22 }}>{keepsPassword ? 'Your saved app password will be kept unless you enter a replacement.' : 'Use an app password created for the Google email above. Spaces in a pasted password are removed automatically.'}</Text>
          {loaded ? feedback : null}
          {saveButton}
          <Text style={{ color: c.secondaryLabel, lineHeight: 22 }}>You can save your Google credentials now and set up sender addresses later.</Text>
          <Button title="Create a Google app password" variant="plain" onPress={() => void WebBrowser.openBrowserAsync('https://myaccount.google.com/apppasswords')} />
          <Text style={{ color: c.secondaryLabel, lineHeight: 22 }}>In Gmail Settings → Accounts → Send mail as, add and verify each address below. Select an address only after Gmail confirms it. Otherwise Gmail can replace your sender address. Free Gmail does not provide aligned DKIM for your domain; keep DMARC at p=none for this path.</Text>
        </View>
        <Section title="Sender addresses · after saving" footer="Select an address only after verifying it in Gmail, then tap Save sender addresses. An unselected address cannot send.">
          {mailboxes.map((m) => <Row key={m.id} title={m.address} checked={aliases.includes(m.address)} onPress={busy || !loaded ? undefined : () => setAliases((a) => a.includes(m.address) ? a.filter((v) => v !== m.address) : [...a,m.address])} />)}
        </Section>
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <ErrorText>{mailboxError}</ErrorText>
          {!mailboxes.length && !mailboxError && loaded ? <Text style={{ color: c.secondaryLabel, lineHeight: 22 }}>No mailbox addresses yet. Save your credentials above, then create a mailbox in Settings → Manage mailboxes.</Text> : null}
          {mailboxes.length > 0 ? <Button title="Save sender addresses" variant="outline" onPress={save} loading={busy} disabled={!loaded} /> : null}
        </View>
      </>}
      {loaded ? <Section title="Default workspace sender" footer="Invitations are emailed from this address. For Gmail, enable and save the verified sender above first.">
        {mailboxes.filter((m) => provider === 'cloudflare' || aliases.includes(m.address)).map((m) => <Row key={m.id} title={m.address} checked={defaultMailbox === m.id} onPress={busy ? undefined : async () => {
          if (!workspace) return;
          setBusy(true); setError(null);
          try { await api(`/v1/tenants/${workspace.id}/sending/default`, {method:'PUT',body:{mailboxId:m.id}}); setDefaultMailbox(m.id); setNotice(`Invitations will be sent from ${m.address}.`); }
          catch (e) { setError(e instanceof Error ? e.message : 'Could not save the default sender.'); }
          finally { setBusy(false); }
        }} />)}
      </Section> : null}
      {provider === 'cloudflare' ? <View style={{ padding: 20, gap: 14 }}>{loaded ? feedback : null}{saveButton}</View> : null}
    </>}
  </KeyboardAwareScrollView>;
}
