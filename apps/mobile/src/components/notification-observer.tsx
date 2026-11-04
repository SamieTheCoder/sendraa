import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import type { NotificationResponse } from 'expo-notifications';
import { api } from '@/lib/api';
import { nativePushAvailable, pushModule, restoreNotifications } from '@/lib/notifications';
import { getMe, setActiveWorkspace, useActiveWorkspace } from '@/lib/workspace';
import { connectWorkspace, loadNotificationThread, refreshMailbox } from '@/mail/live';
import { getMail, setActiveAccount, useMail } from '@/mail/store';

type MailNotification={kind:'mail';tenantId:string;mailboxId:string;threadId:string;messageId:string;userId:string};
function mailData(value:Record<string,unknown>|undefined):MailNotification|null {
  const valid=/^[0-9a-f-]{36}$/i;
  if(!value || value.kind!=='mail' || typeof value.userId!=='string')return null;
  for(const k of ['tenantId','mailboxId','threadId','messageId'])if(typeof value[k]!=='string' || !valid.test(value[k] as string))return null;
  return value as MailNotification;
}
let handling:string|null=null;
export function NotificationObserver({userId}:{userId:string}) {
  const {settings}=useMail();
  const workspace=useActiveWorkspace();
  const activeWorkspace=useRef(workspace?.id);
  useEffect(()=>{activeWorkspace.current=workspace?.id;},[workspace?.id]);
  useEffect(()=>{
    const restore=()=>void restoreNotifications({preference:settings.notifications,copyOtp:settings.copyOtp}).catch(()=>undefined);
    restore();
    const sub=AppState.addEventListener('change',(state)=>{if(state==='active')restore();});
    return ()=>sub.remove();
  },[userId,settings.notifications,settings.copyOtp]);
  useEffect(()=>{
    if(!nativePushAvailable())return;
    let alive=true;
    const subscriptions:{remove:()=>void}[]=[];
    const handle=async(response:NotificationResponse)=>{
      const data=mailData(response.notification.request.content.data);
      const key=`${response.notification.request.identifier}:${response.actionIdentifier}`;
      if(!data || data.userId!==userId || !getMe()?.workspaces.some((w)=>w.id===data.tenantId) || handling===key)return;
      handling=key;
      const n=await pushModule();
      n.clearLastNotificationResponse();
      try {
        if(response.actionIdentifier==='COPY_OTP') {
          if(!getMail().settings.copyOtp)throw new Error('Copy code is turned off in Notification settings.');
          const result=await api<{code:string}>(`/v1/tenants/${data.tenantId}/mailboxes/${data.mailboxId}/threads/${data.threadId}/messages/${data.messageId}/otp`);
          if(!alive || getMe()?.user.id!==userId)return;
          await Clipboard.setStringAsync(result.code);
          await n.dismissNotificationAsync(response.notification.request.identifier);
          Alert.alert('Code copied','Your verification code is ready to paste.');
        } else {
          setActiveWorkspace(data.tenantId);
          await connectWorkspace(data.tenantId);
          await loadNotificationThread(data.tenantId,data.mailboxId,data.threadId);
          if(!alive)return;
          setActiveAccount(data.mailboxId);
          router.push({pathname:'/thread/[id]',params:{id:data.threadId}});
        }
      } catch(e) { if(alive)Alert.alert('Notification',e instanceof Error ? e.message : 'Could not open this message.'); }
      finally {handling=null;}
    };
    void pushModule().then((n)=>{
      if(!alive)return;
      n.setNotificationHandler({handleNotification:async(notification)=>{
        const data=mailData(notification.request.content.data);
        const show=data?.userId===getMe()?.user.id && getMail().settings.notifications!=='none';
        return {shouldShowBanner:show,shouldShowList:show,shouldPlaySound:show,shouldSetBadge:false};
      }});
      subscriptions.push(n.addPushTokenListener(()=>{const current=getMail().settings;void restoreNotifications({preference:current.notifications,copyOtp:current.copyOtp}).catch(()=>undefined);}));
      subscriptions.push(n.addNotificationResponseReceivedListener((r)=>void handle(r)));
      subscriptions.push(n.addNotificationReceivedListener((notification)=>{
        const data=mailData(notification.request.content.data);
        if(data?.userId===userId && data.tenantId===activeWorkspace.current && getMail().accounts.some((a)=>a.id===data.mailboxId))void refreshMailbox(data.mailboxId).catch(()=>undefined);
      }));
      const last=n.getLastNotificationResponse();
      if(last)void handle(last);
    });
    return ()=>{alive=false;subscriptions.forEach((s)=>s.remove());};
  },[userId]);
  return null;
}
