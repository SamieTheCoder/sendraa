import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, ErrorText, Field } from '@/components/form';
import { Row, Section, SwitchRow } from '@/components/grouped-list';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';

export default function NewMailbox() {
  const c=useColors(); const workspace=useActiveWorkspace();
  const [domains,setDomains]=useState<{ id: string; name: string }[]>([]); const [domainId,setDomainId]=useState('');
  const [localPart,setLocalPart]=useState(''); const [displayName,setDisplayName]=useState(''); const [shared,setShared]=useState(false);
  const [error,setError]=useState<string | null>(null); const [busy,setBusy]=useState(false);
  useEffect(() => { if (workspace) api<{ domains: { id: string; name: string }[] }>(`/v1/tenants/${workspace.id}/domains`).then((r) => { setDomains(r.domains); setDomainId(r.domains[0]?.id ?? ''); }).catch((e: Error) => setError(e.message)); }, [workspace]);
  const create=async () => {
    if (!workspace || busy) return; setBusy(true); setError(null);
    try { const m=await api<{ id: string }>(`/v1/tenants/${workspace.id}/mailboxes`, { method:'POST', body:{ localPart,domainId,displayName,shared } }); router.replace({ pathname:'/mailboxes/[id]',params:{ id:m.id } }); }
    catch(e) { setError(e instanceof Error ? e.message : 'Could not create mailbox.'); } finally { setBusy(false); }
  };
  if(!shared) return <KeyboardAwareScrollView contentInsetAdjustmentBehavior="automatic" style={{backgroundColor:c.groupedBackground}} contentContainerStyle={{padding:20,gap:18}}>
    <Stack.Screen options={{title:'Create mailbox'}}/>
    <Text style={{color:c.label,fontSize:25,fontWeight:'700'}}>A work address of their own</Text>
    <Text style={{color:c.secondaryLabel,lineHeight:22}}>Create a personal mailbox and invite its user by personal email. They choose their password, sign in with their work address, and keep their mail private from workspace admins.</Text>
    <Button title="Create personal mailbox and invite" variant="brand" onPress={()=>router.replace('/people/invite')}/>
    <Button title="Create a shared team mailbox" variant="outline" onPress={()=>setShared(true)}/>
  </KeyboardAwareScrollView>;
  return <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor:c.groupedBackground }} contentContainerStyle={{ paddingBottom:48 }}>
    <Stack.Screen options={{ title:'Create mailbox' }} />
    <View style={{ padding:20,gap:18 }}><Field label="Email address" placeholder="priya or support" value={localPart} onChangeText={setLocalPart} autoCapitalize="none" autoCorrect={false} editable={!busy} />
      <Text style={{ color:c.secondaryLabel }}>{localPart || 'name'}@{domains.find((d)=>d.id===domainId)?.name || 'your domain'}</Text>
      <Field label="Display name" placeholder="Priya Sharma or Support" value={displayName} onChangeText={setDisplayName} editable={!busy} /></View>
    <Section title="Domain">{domains.map((d)=><Row key={d.id} title={d.name} checked={d.id===domainId} onPress={busy ? undefined : ()=>setDomainId(d.id)} />)}</Section>
    <Section footer="A mailbox is an email address. People sign in with their own account and receive access through an invite or an admin grant."><SwitchRow title="Shared mailbox" subtitle="For a team address such as support@" value={shared} onValueChange={(v)=>{if(!busy)setShared(v);}} /></Section>
    <View style={{ padding:20,gap:14 }}><ErrorText>{error}</ErrorText>{!domainId ? <Text style={{ color:c.secondaryLabel }}>Finish Email setup to connect a domain first.</Text> : null}<Button title="Create mailbox" variant="brand" loading={busy} disabled={!domainId || !localPart.trim()} onPress={create} /></View>
  </KeyboardAwareScrollView>;
}
