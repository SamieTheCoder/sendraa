import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, NoticeText } from '@/components/form';
import { Row, Section, SwitchRow } from '@/components/grouped-list';
import { disableNotifications, registerNotifications, type NotificationPreference } from '@/lib/notifications';
import { updateSettings, useMail } from '@/mail/store';
import { useColors } from '@/theme/colors';

export default function NotificationSettings() {
  const c=useColors(); const {settings}=useMail();
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);
  const save=async(preference:NotificationPreference,copyOtp=settings.copyOtp)=>{
    if(busy)return;
    setBusy(true);setError(null);setNotice(null);
    try {
      if(preference==='none')await disableNotifications();
      else await registerNotifications({preference,copyOtp},true);
      updateSettings({notifications:preference,copyOtp});
      setNotice(preference==='none'?'Notifications are off on this device.':'Notifications are enabled on this device.');
    } catch(e) {setError(e instanceof Error ? e.message : 'Could not update notifications.');}
    finally{setBusy(false);}
  };
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{backgroundColor:c.groupedBackground}} contentContainerStyle={{paddingBottom:48}}>
    <Stack.Screen options={{title:'Notifications'}} />
    <View style={{padding:20,gap:10}}><Text style={{fontSize:26,fontWeight:'700',color:c.label}}>Mail, when it arrives.</Text><Text style={{color:c.secondaryLabel,lineHeight:22}}>Get alerts for the mailboxes you can read. Message content stays private on your lock screen.</Text></View>
    <View style={{paddingHorizontal:20,paddingBottom:20,gap:12}}><ErrorText>{error}</ErrorText><NoticeText>{notice}</NoticeText>
      <Button title="Enable notifications" variant="brand" loading={busy} onPress={()=>void save(settings.notifications==='none'?'all':settings.notifications)} />
      <Button title="Open device settings" variant="plain" onPress={()=>void Linking.openSettings()} />
    </View>
    <Section title="Notify me" footer="Applies to this device across your workspaces. Important only uses the conversation’s Important flag.">
      {([{value:'all',title:'All new mail'},{value:'important',title:'Important only'},{value:'none',title:'Off'}] as const).map((item)=><Row key={item.value} title={item.title} checked={settings.notifications===item.value} onPress={busy ? undefined : ()=>void save(item.value)} />)}
    </Section>
    <Section title="Verification codes" footer="When a single numeric code is detected, expand or long-press the notification and choose Copy code. Sendraa opens, checks your access, and copies the code. Codes are never included in the push payload. The action expires after 15 minutes.">
      <SwitchRow title="Copy code action" subtitle="For verification and one-time passwords" value={settings.copyOtp} onValueChange={(value)=>{if(!busy)void save(settings.notifications,value);}} />
    </Section>
  </ScrollView>;
}
