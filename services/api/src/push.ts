import { z } from 'zod';
import { one, pool, query, transaction } from './db.js';
import { env } from './env.js';
import { effectivePermissions } from './iam/policy.js';
import { mailboxResource, parseResource } from './iam/roles.js';
import { extractOtp } from './otp.js';
import { readyWorker, workerFetch } from './worker-client.js';

export type MailEvent = {tenantId:string;mailboxId:string;threadId:string;messageId:string};
const threadSchema = z.object({
  location:z.string(), important:z.boolean(), subject:z.string(),
  messages:z.array(z.object({id:z.string(),text:z.string().nullable(),html:z.string().nullable(),receivedAt:z.string().optional(),date:z.string().optional(),needsParse:z.boolean().optional()})),
});
export async function notificationMessage(event:MailEvent) {
  const response = await workerFetch(await readyWorker(event.tenantId),'GET',`/v1/mailboxes/${event.mailboxId}/threads/${event.threadId}`);
  if (!response.ok) throw new Error('Mail service unavailable');
  const thread = threadSchema.parse(await response.json());
  const message = thread.messages.find((m)=>m.id===event.messageId);
  if (!message) throw new Error('Message unavailable');
  return {thread,message,code:extractOtp(thread.subject,message.text,message.html)};
}

/** Enqueue once, under the signed webhook. Recheck authorization again before delivery. */
export async function enqueueMail(event: MailEvent) {
  await transaction(async (db) => {
    const mailbox = await one('select id from mailbox where id=$1 and tenant_id=$2',[event.mailboxId,event.tenantId],db);
    if (!mailbox) return;
    const inserted = await one<{id:string}>(`insert into push_event(tenant_id,mailbox_id,thread_id,message_id) values($1,$2,$3,$4) on conflict do nothing returning id`,[event.tenantId,event.mailboxId,event.threadId,event.messageId],db);
    if (!inserted) return;
    const devices = await query<{id:string;user_id:string}>(`select d.id,d.user_id from push_device d join session s on s.id=d.session_id join tenant_member m on m.user_id=d.user_id where m.tenant_id=$1 and s."expiresAt">now() and d.preference <> 'none'`,[event.tenantId],db);
    const resource = parseResource(mailboxResource(event.tenantId,event.mailboxId))!;
    for (const device of devices) {
      if ((await effectivePermissions(device.user_id,resource,db)).has('mail.read')) {
        await db.query('insert into push_delivery(event_id,device_id) values($1,$2) on conflict do nothing',[inserted.id,device.id]);
      }
    }
  });
}

const ticketSchema = z.object({status:z.enum(['ok','error']),id:z.string().optional(),details:z.object({error:z.string().optional()}).optional()});
async function expo(path:string, body:unknown) {
  const response = await fetch(`https://exp.host/--/api/v2/push/${path}`,{
    method:'POST',headers:{'content-type':'application/json',...(env.EXPO_ACCESS_TOKEN ? {authorization:`Bearer ${env.EXPO_ACCESS_TOKEN}`} : {})},
    body:JSON.stringify(body),signal:AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`EXPO_HTTP_${response.status}`);
  return response.json() as Promise<{data:unknown}>;
}

type Job = {event_id:string;device_id:string;attempts:number};
type Destination = {tenant_id:string;mailbox_id:string;thread_id:string;message_id:string;created_at:Date;token:string;user_id:string;preference:string;copy_otp:boolean};
async function dispatch(job:Job) {
  const params=[job.event_id,job.device_id];
  const finish = (status:string,error:string|null=null) => pool.query('update push_delivery set status=$3,error_code=$4 where event_id=$1 and device_id=$2',[...params,status,error]);
  const target = await one<Destination>(`select e.*,d.token,d.user_id,d.preference,d.copy_otp from push_event e join push_device d on d.id=$2 join session s on s.id=d.session_id where e.id=$1 and s."expiresAt">now()`,params);
  if (!target || target.preference==='none' || Date.now()-target.created_at.getTime()>15*60_000) { await finish('skipped'); return; }
  const resource = parseResource(mailboxResource(target.tenant_id,target.mailbox_id))!;
  if (!(await effectivePermissions(target.user_id,resource)).has('mail.read')) { await finish('skipped'); return; }
  let details: Awaited<ReturnType<typeof notificationMessage>>;
  try {
    details = await notificationMessage({tenantId:target.tenant_id,mailboxId:target.mailbox_id,threadId:target.thread_id,messageId:target.message_id});
  } catch {
    await pool.query(`update push_delivery set status=$3,next_attempt_at=now()+interval '30 seconds',error_code='MAIL_UNAVAILABLE' where event_id=$1 and device_id=$2`,[...params,job.attempts<5?'pending':'failed']);
    return;
  }
  if (['spam','trash'].includes(details.thread.location) || (target.preference==='important' && !details.thread.important)) { await finish('skipped'); return; }
  // No subject, body, sender, or OTP leaves the tenant via Expo/APNs/FCM.
  // Worker fetch may take seconds: a logout/revocation while it runs must cancel delivery.
  const stillRegistered=await one(`select 1 from push_device d join session s on s.id=d.session_id where d.id=$1 and d.user_id=$2 and d.token=$3 and d.preference<>'none' and s."expiresAt">now()`,[job.device_id,target.user_id,target.token]);
  if(!stillRegistered || !(await effectivePermissions(target.user_id,resource)).has('mail.read')) {await finish('skipped');return;}
  const hasCode = Boolean(details.code && target.copy_otp);
  try {
    const result = await expo('send',{
      to:target.token,title:hasCode?'Verification code received':'New mail',body:hasCode?'Open Sendraa or choose Copy code.':'Open Sendraa to read your message.',
      data:{kind:'mail',userId:target.user_id,tenantId:target.tenant_id,mailboxId:target.mailbox_id,threadId:target.thread_id,messageId:target.message_id},
      ...(hasCode ? {categoryId:'mail_otp'} : {}),channelId:'mail',sound:'default',priority:'high',ttl:900,
    });
    const ticket = ticketSchema.parse(Array.isArray(result.data)?result.data[0]:result.data);
    if (ticket.status==='ok' && ticket.id) {
      await pool.query(`update push_delivery set status='ticket',ticket_id=$3,next_attempt_at=now()+interval '15 minutes' where event_id=$1 and device_id=$2`,[...params,ticket.id]);
    } else {
      await finish('failed',ticket.details?.error ?? 'EXPO_REJECTED');
      if(ticket.details?.error==='DeviceNotRegistered') await pool.query('delete from push_device where id=$1 and token=$2',[job.device_id,target.token]);
    }
  } catch {
    // The provider may have accepted a timed-out request. Never send a duplicate blindly.
    await finish('failed','PUSH_OUTCOME_UNKNOWN');
  }
}

export async function processPushQueue() {
  // Recover process interruptions without replaying an uncertain Expo send.
  await pool.query(`update push_delivery set status='failed',error_code='PROCESS_INTERRUPTED' where status='sending' and next_attempt_at<now()-interval '2 minutes'`);
  const jobs = await query<Job>(`with selected as (select event_id,device_id from push_delivery where status='pending' and next_attempt_at<=now() order by next_attempt_at for update skip locked limit 20)
    update push_delivery d set status='sending',attempts=attempts+1,next_attempt_at=now() from selected s where d.event_id=s.event_id and d.device_id=s.device_id returning d.event_id,d.device_id,d.attempts`);
  for (let i=0;i<jobs.length;i+=4) await Promise.all(jobs.slice(i,i+4).map(dispatch));
  const tickets = await query<{event_id:string;device_id:string;ticket_id:string}>(`select event_id,device_id,ticket_id from push_delivery where status='ticket' and next_attempt_at<=now() limit 100`);
  if (tickets.length) {
    const result = await expo('getReceipts',{ids:tickets.map((t)=>t.ticket_id)});
    const receipts = z.record(z.string(),ticketSchema).parse(result.data);
    for (const job of tickets) {
      const receipt=receipts[job.ticket_id];
      if(!receipt) { await pool.query(`update push_delivery set next_attempt_at=now()+interval '15 minutes' where event_id=$1 and device_id=$2`,[job.event_id,job.device_id]); continue; }
      await pool.query('update push_delivery set status=$3,error_code=$4 where event_id=$1 and device_id=$2',[job.event_id,job.device_id,receipt.status==='ok'?'delivered':'failed',receipt.details?.error ?? null]);
      if(receipt.details?.error==='DeviceNotRegistered') await pool.query('delete from push_device where id=$1 and updated_at <= (select created_at from push_event where id=$2)',[job.device_id,job.event_id]);
    }
  }
  await pool.query("delete from push_event where created_at<now()-interval '7 days'");
}

export function startPushDispatcher() {
  let running=false;
  const timer=setInterval(()=>{
    if(running)return;
    running=true;
    void processPushQueue().catch(()=>console.error(JSON.stringify({message:'Push queue processing failed'}))).finally(()=>{running=false;});
  },5_000);
  timer.unref();
  return ()=>clearInterval(timer);
}
