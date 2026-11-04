import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Field, NoticeText } from '@/components/form';
import { Row, Section } from '@/components/grouped-list';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace';
import { useColors } from '@/theme/colors';
import type { ManagedMailbox } from './index';
type Member = { id:string;name:string;email:string;bindings:{resource:string;role:string}[] };

export default function MailboxAccess() {
  const { id }=useLocalSearchParams<{id:string}>(); const c=useColors(); const workspace=useActiveWorkspace();
  const [mailbox,setMailbox]=useState<ManagedMailbox | null>(null); const [members,setMembers]=useState<Member[]>([]);
  const [error,setError]=useState<string|null>(null); const [notice,setNotice]=useState<string|null>(null); const [busy,setBusy]=useState(false);
  const [confirmAddress,setConfirmAddress]=useState('');
  const base=`/v1/tenants/${workspace?.id}`; const resource=`tenants/${workspace?.id}/mailboxes/${id}`;
  const load=useCallback(async ()=>{
    if (!workspace) return;
    const [b,m]=await Promise.all([api<{mailboxes:ManagedMailbox[]}>(`/v1/tenants/${workspace.id}/mailboxes?manage=true`),api<{members:Member[]}>(`/v1/tenants/${workspace.id}/members`)]);
    const found=b.mailboxes.find((x)=>x.id===id); if(!found) throw new Error('Mailbox not found.'); setMailbox(found);setMembers(m.members);
  },[workspace,id]);
  useFocusEffect(useCallback(()=>{void load().catch((e:Error)=>setError(e.message));},[load]));
  const setAccess=async (member:Member,role:string|null)=>{
    if(busy)return;setBusy(true);setError(null);setNotice(null);
    try{await api(`${base}/mailboxes/${id}/access`,{method:'PUT',body:{userId:member.id,role}});await load();setNotice('Mailbox access updated.');}
    catch(e){setError(e instanceof Error?e.message:'Could not update access.');}finally{setBusy(false);}
  };
  const choose=(m:Member)=>Alert.alert(`Access for ${m.name||m.email}`,'Workspace roles still apply. These choices change only direct access to this mailbox.',[
    {text:'Read and send',onPress:()=>void setAccess(m,'roles/mailUser')},{text:'Read only',onPress:()=>void setAccess(m,'roles/mailReader')},
    {text:'Remove direct access',style:'destructive',onPress:()=>void setAccess(m,null)},
    ...(process.env.EXPO_OS==='ios'?[{text:'Cancel',style:'cancel' as const}]:[]),
  ],{cancelable:true});
  const activate=async()=>{setBusy(true);setError(null);try{await api(`${base}/mailboxes/${id}/activate`,{method:'POST'});await load();setNotice('Mailbox is active and ready to receive.');}catch(e){setError(e instanceof Error?e.message:'Activation failed.');}finally{setBusy(false);}};
  const remove=async()=>{
    if(busy||!mailbox)return;setBusy(true);setError(null);setNotice(null);
    try {
      for(let page=0;page<50;page++) {
        const result=await api<{done:boolean}>(`${base}/mailboxes/${id}`,{method:'DELETE',body:{confirmAddress}});
        if(result.done){router.replace('/mailboxes');return;}
      }
      await load();setNotice('Deletion is in progress. Tap Continue deletion to remove the remaining files.');
    }catch(e){setError(e instanceof Error?e.message:'Could not complete deletion. Retry to continue.');await load().catch(()=>undefined);}
    finally{setBusy(false);}
  };
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{backgroundColor:c.groupedBackground}} contentContainerStyle={{paddingBottom:48}}>
    <Stack.Screen options={{title:'Mailbox access'}} />
    <View style={{padding:20,gap:14}}><ErrorText>{error}</ErrorText><NoticeText>{notice}</NoticeText>{!mailbox&&!error?<ActivityIndicator/>:null}
      {mailbox?<><Text selectable style={{color:c.label,fontSize:23,fontWeight:'700'}}>{mailbox.address}</Text><Text style={{color:c.secondaryLabel}}>{mailbox.shared?'Shared mailbox':'Personal mailbox'} · {mailbox.synced_at?'Active':'Needs activation'}</Text>
      {!mailbox.shared?<Text style={{color:c.secondaryLabel,lineHeight:22}}>Only the assigned user can open this mailbox in Sendraa. Workspace admins manage the address, not its messages.</Text>:null}
      {!mailbox.synced_at&&!mailbox.deleting_at?<Button title="Activate mailbox" variant="brand" loading={busy} onPress={activate}/>:null}
      {!mailbox.deleting_at&&(mailbox.shared||!mailbox.owner_user_id)&&workspace?.permissions.includes('members.invite')?<Button title="Invite someone to this mailbox" variant="outline" disabled={busy} onPress={()=>router.push({pathname:'/people/invite',params:{mailboxId:id}})}/>:null}</>:null}
    </View>
    <Section title={mailbox?.shared?'Workspace members':mailbox?.owner_user_id?'Mailbox owner':'Assign to a workspace member'} footer={mailbox?.shared?'Shared mailbox access follows direct and workspace roles.':'Personal mail is not inherited through workspace roles. New invitees choose their own password and can sign in with their work email.'}>
      {members.filter((m)=>mailbox?.shared||!mailbox?.owner_user_id||m.id===mailbox.owner_user_id).map((m)=>{
        const direct=m.bindings.find((b)=>b.resource===resource);const inherited=m.bindings.filter((b)=>b.resource===`tenants/${workspace?.id}`).map((b)=>b.role.split('/')[1]);
        const editable=!mailbox?.deleting_at&&(mailbox?.shared||!mailbox?.owner_user_id)&&workspace?.permissions.includes('iam.policy.set');
        return <Row key={m.id} title={m.name||m.email} subtitle={`${m.email}\n${m.id===mailbox?.owner_user_id?'Personal owner':direct?.role==='roles/mailUser'?'Read and send':direct?.role==='roles/mailReader'?'Read only':'No direct access'}${mailbox?.shared&&inherited.length?` · Workspace: ${inherited.join(', ')}`:''}`} navigates={editable} onPress={!busy&&editable?()=>choose(m):undefined}/>;
      })}
    </Section>
    {mailbox&&workspace?.permissions.includes('mailboxes.delete')?<View style={{padding:20,gap:14}}>
      <Text style={{color:c.red,fontSize:18,fontWeight:'600'}}>Delete mailbox</Text>
      <Text style={{color:c.secondaryLabel,lineHeight:22}}>Permanently removes this address, its messages and attachments from Cloudflare. {mailbox.account_user_id ? 'Its separate work login and sessions are also deleted. The recipient’s personal account is kept.' : 'Its sign-in alias is removed. The person’s existing account and other mailboxes are kept.'}</Text>
      <Field label="Type the mailbox address to confirm" value={confirmAddress} onChangeText={setConfirmAddress} autoCapitalize="none" autoCorrect={false} placeholder={mailbox.address} editable={!busy}/>
      <Button title={mailbox.deleting_at?'Continue deletion':'Delete mailbox permanently'} variant="outline" loading={busy} disabled={confirmAddress.trim().toLowerCase()!==mailbox.address.toLowerCase()} onPress={()=>Alert.alert('Permanently delete this mailbox?',`All messages and attachments for ${mailbox.address} will be removed. This cannot be undone.`,[{text:'Cancel',style:'cancel'},{text:'Delete mailbox',style:'destructive',onPress:()=>void remove()}])}/>
    </View>:null}
  </ScrollView>;
}
