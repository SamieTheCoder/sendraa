import { useEffect, useSyncExternalStore } from 'react';
import { authClient } from './auth-client';
import { authError } from './auth-feedback';
import { resetMe } from './workspace';
import { disconnectMail } from '@/mail/live';
import { activateMailIdentity } from '@/mail/store';

let identity: string | null | undefined;
const listeners = new Set<()=>void>();

/** The navigator stays covered until both the identity and its local mail scope match. */
export function useIdentityScope(userId:string|null) {
  const current=useSyncExternalStore((l)=>{listeners.add(l);return()=>listeners.delete(l);},()=>identity,()=>identity);
  useEffect(()=>{
    if(identity===userId)return;
    disconnectMail(); resetMe(); activateMailIdentity(userId);
    identity=userId;listeners.forEach((l)=>l());
  },[userId]);
  return current===userId;
}

export async function rememberCurrentSession() {
  const result=await authClient.$fetch('/multi-session/remember',{method:'POST',body:{}});
  if(result.error)throw new Error(authError(result.error));
}

export async function signOutCurrentAccount() {
  const current=await authClient.getSession();
  if(!current.data)return;
  await rememberCurrentSession();
  const result=await authClient.multiSession.revoke({sessionToken:current.data.session.token});
  if(result.error)throw new Error(authError(result.error));
  authClient.$store.notify("$sessionSignal");
  await authClient.getSession({query:{disableCookieCache:true}});
}
