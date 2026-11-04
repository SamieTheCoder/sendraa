import { sessionInit } from '@/lib/api';
import { API_URL } from '@/lib/auth-client';

export type DownloadedAttachment = { uri:string; save:()=>Promise<void>; dispose:()=>void };

export async function downloadAttachment(tenantId:string, mailboxId:string, id:string, name:string):Promise<DownloadedAttachment> {
  const init = await sessionInit();
  const response = await fetch(`${API_URL}/v1/tenants/${tenantId}/mailboxes/${mailboxId}/attachments/${id}`,init);
  if(!response.ok)throw new Error('Could not download this attachment. Check your connection and mailbox access, then retry.');
  const uri = URL.createObjectURL(await response.blob());
  return {uri, dispose:()=>URL.revokeObjectURL(uri), save:async()=>{
    const anchor = document.createElement('a'); anchor.href=uri; anchor.download=name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  }};
}
