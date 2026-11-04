import PostalMime from 'postal-mime';
import { workerFetch, workerPutBytes, type WorkerTarget } from './worker-client.js';

const MAX_RAW=32*1024*1024;
const inFlight=new Map<string,Promise<void>>();
let active=0;

/** Bounded, on-demand parsing. Raw content stays in memory and is written back to tenant R2/D1. */
export async function parseStoredMessage(worker:WorkerTarget, mailboxId:string, messageId:string):Promise<void> {
  const key=`${worker.worker_url}/${mailboxId}/${messageId}`;
  const existing=inFlight.get(key);if(existing)return existing;
  if(active>=2)throw new Error('Other messages are being processed. Tap Retry in a moment.');
  const job=(async()=>{
    active++;
    try {
      const health=await workerFetch(worker,'GET','/v1/health');
      const status=health.ok?await health.json() as {capabilities?:string[]}:null;
      if(!status?.capabilities?.includes('parsed-message'))throw new Error('Ask your workspace admin to update Email setup, then retry this message.');
      const response=await workerFetch(worker,'GET',`/v1/mailboxes/${mailboxId}/messages/${messageId}/raw`);
      if(!response.ok)throw new Error('Could not retrieve the original message. Tap Retry.');
      const reader=response.body?.getReader();if(!reader)throw new Error('The original message is unavailable.');
      const chunks:Uint8Array[]=[];let size=0;
      while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>MAX_RAW){await reader.cancel();throw new Error('This message exceeds the 32 MiB processing limit.');}chunks.push(next.value);}
      const raw=Buffer.concat(chunks,size);
      const parsed=await PostalMime.parse(raw);
      if(parsed.attachments.length>50)throw new Error('This message contains more than 50 attachments.');
      if(Buffer.byteLength((parsed.text??'')+(parsed.html??''))>1024*1024)throw new Error('The message text exceeds the 1 MiB display limit.');
      const attachments=[];
      for(const [i,a] of parsed.attachments.entries()) {
        const bytes=typeof a.content==='string'?Buffer.from(a.content):new Uint8Array(a.content);
        await workerPutBytes(worker,`/v1/mailboxes/${mailboxId}/outbound/parse-${messageId}/att-${i}`,bytes);
        attachments.push({name:(a.filename||`Attachment ${i+1}`).slice(0,512),type:a.mimeType.slice(0,128),size:bytes.byteLength,contentId:a.contentId?.replace(/^<|>$/g,'')??null,inline:a.disposition==='inline'||Boolean(a.related)});
      }
      const saved=await workerFetch(worker,'PUT',`/v1/mailboxes/${mailboxId}/messages/${messageId}/parsed`,{text:parsed.text??null,html:parsed.html??null,attachments});
      if(!saved.ok)throw new Error('Could not save the processed message. Tap Retry.');
    } finally {active--;}
  })();
  inFlight.set(key,job);
  try {await job;} finally {inFlight.delete(key);}
}
