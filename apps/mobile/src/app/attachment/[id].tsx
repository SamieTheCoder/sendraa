import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText } from '@/components/form';
import { downloadAttachment, type DownloadedAttachment } from '@/mail/download-attachment';
import { fileSize } from '@/mail/format';
import { useMail } from '@/mail/store';
import { useColors } from '@/theme/colors';

export default function AttachmentScreen() {
  const {id,threadId}=useLocalSearchParams<{id:string;threadId:string}>();
  return <AttachmentViewer key={`${threadId}/${id}`} />;
}

function AttachmentViewer() {
  const {id,threadId}=useLocalSearchParams<{id:string;threadId:string}>();
  const c=useColors();
  const state=useMail();
  const thread=state.threads.find((t)=>t.id===threadId);
  const attachment=thread?.messages.flatMap((m)=>m.attachments).find((a)=>a.id===id);
  const tenantId=thread?.remote?.tenantId, mailboxId=thread?.accountId;
  const name=attachment?.name;
  const [download,setDownload]=useState<DownloadedAttachment|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [attempt,setAttempt]=useState(0);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [previewFailed,setPreviewFailed]=useState(false);
  useEffect(()=>{
    let disposed=false; let result:DownloadedAttachment|undefined;
    if(!tenantId||!mailboxId||!name)return;
    downloadAttachment(tenantId,mailboxId,id,name).then((file)=>{
      result=file; if(disposed)file.dispose();else setDownload(file);
    }).catch((err)=>{if(!disposed)setError(err instanceof Error?err.message:'Could not load attachment.');});
    return ()=>{disposed=true;result?.dispose();};
  },[tenantId,mailboxId,id,name,attempt]);
  const save=async()=>{
    if(!download||saving)return;
    setSaving(true);setError(null);
    try{await download.save();setSaved(true);}
    catch(err){if(!/cancel/i.test(String(err)))setError('Could not save the file. Choose another folder or check whether a file with this name already exists.');}
    finally{setSaving(false);}
  };
  const displayError=(!attachment||!tenantId)?'This attachment is no longer available.':error;
  const isImage=/^image\/(png|jpe?g|gif|webp|avif|heic|heif|bmp)$/i.test(attachment?.type??'');
  return <>
    <Stack.Screen options={{title:'Attachment'}}/>
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{backgroundColor:c.background}} contentContainerStyle={{padding:20,gap:20,paddingBottom:48}}>
      <Text selectable style={{color:c.label,fontSize:20,fontWeight:'600'}}>{name??'Attachment'}</Text>
      {attachment?<Text style={{color:c.secondaryLabel}}>{fileSize(attachment.size)}</Text>:null}
      {!download&&!displayError?<ActivityIndicator accessibilityLabel="Downloading attachment" color={c.tint}/>:null}
      {download&&isImage&&!previewFailed?<View style={{height:420,backgroundColor:c.fill,borderRadius:12,overflow:'hidden'}}><Image source={{uri:download.uri}} style={{flex:1}} contentFit="contain" cachePolicy="none" accessibilityLabel={name} onError={()=>setPreviewFailed(true)}/></View>:null}
      {download&&(!isImage||previewFailed)?<Text style={{color:c.secondaryLabel}}>Save this file to open it in another app.</Text>:null}
      <ErrorText>{displayError}</ErrorText>
      {download?<Button title={saved?'Save another copy':'Save file'} loading={saving} onPress={()=>void save()}/>:displayError?<Button title="Retry download" variant="outline" onPress={()=>{setError(null);setAttempt((n)=>n+1);}}/>:null}
      {saved?<Text style={{color:c.secondaryLabel}} accessibilityLiveRegion="polite">File saved.</Text>:null}
    </ScrollView>
  </>;
}
