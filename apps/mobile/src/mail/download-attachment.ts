import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { sessionInit } from '@/lib/api';
import { API_URL } from '@/lib/auth-client';

export type DownloadedAttachment = { uri:string; save:()=>Promise<void>; dispose:()=>void };

export async function downloadAttachment(tenantId:string, mailboxId:string, id:string, name:string):Promise<DownloadedAttachment> {
  const {headers} = await sessionInit();
  const directory = new Directory(Paths.cache, `mail-${randomUUID()}`);
  directory.create();
  const safeName = name.replace(/[/\\\u0000-\u001f\u007f]/g,'_').replace(/^\.+/,'').slice(0,180) || 'Attachment';
  const file = new File(directory,safeName);
  const dispose = () => { try { if(directory.exists) directory.delete(); } catch { /* Cache can be cleared by the OS. */ } };
  try {
    await File.downloadFileAsync(`${API_URL}/v1/tenants/${tenantId}/mailboxes/${mailboxId}/attachments/${id}`,file,{headers});
    return {uri:file.uri, dispose, save:async()=>{
      const destination = await Directory.pickDirectoryAsync();
      await file.copy(destination);
    }};
  } catch { dispose(); throw new Error('Could not download this attachment. Check your connection and mailbox access, then retry.'); }
}
