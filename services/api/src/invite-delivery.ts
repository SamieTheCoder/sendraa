import { createHmac, randomUUID } from 'node:crypto';
import { cloudflareFor } from './cloudflare.js';
import { open } from './crypto.js';
import { one, pool } from './db.js';
import { invitationEmail } from './invite-template.js';
import { env } from './env.js';
import { DeliveryError, sendCloudflare, sendGmail, type Outbound } from './sending-provider.js';

/** Inviting is its own permission. Callers cannot supply arbitrary mail or sender headers. */
export async function deliverInvite(tid: string, actorId: string, inviteId: string, email: string, link: string) {
  const config = await one<{ provider: string; credentials_enc: string | null; gmail_user: string | null; allowed_from: string[]; default_mailbox_id: string | null }>('select * from sending_config where tenant_id=$1',[tid]);
  if (!config) return { emailSent:false, deliveryError:'Sending is not configured. Share the invite link instead.' };
  const sender = await one<{ id:string; address:string; display_name:string }>(`select id,address,display_name from mailbox where tenant_id=$1 and deleting_at is null
    and (shared or owner_user_id=$5 or owner_user_id=(select cloudflare_user_id from tenant where id=$1))
    and ($2::text='cloudflare' or address::text in (select jsonb_array_elements_text($3))) and ($4::uuid is null or id=$4)
    order by (split_part(address::text,'@',1)='admin') desc,created_at,id limit 1`,[tid,config.provider,JSON.stringify(config.allowed_from),config.default_mailbox_id,actorId]);
  if (!sender) return { emailSent:false, deliveryError:'No verified sender is available. Share the invite link instead.' };
  const tenant = await one<{name:string;cloudflare_user_id:string;cloudflare_account_id:string}>('select name,cloudflare_user_id,cloudflare_account_id from tenant where id=$1',[tid]);
  const scope = await one<{ address: string; shared: boolean }>(`select m.address,m.shared from invite i join mailbox m on i.resource='tenants/' || i.tenant_id || '/mailboxes/' || m.id where i.id=$1 and m.tenant_id=$2`, [inviteId,tid]);
  const name=tenant!.name.replace(/[\r\n\0]/g,' ');
  const mail:Outbound={requestKey:`invite-${inviteId}`,from:{address:sender.address,name},to:[{address:email,name:''}],cc:[],bcc:[],subject:`Join ${name} on Sendraa`,
    ...invitationEmail({ workspace:name,email,address:scope?.address ?? null,separateAccount:scope ? !scope.shared : false,link,logoUrl:`${env.BETTER_AUTH_URL}/assets/sendraa-logo.png`,days:env.INVITE_TTL_DAYS }),
    attachments:[],threadId:null,inReplyTo:null,references:[],date:new Date().toISOString(),messageId:`<${randomUUID()}@${sender.address.split('@')[1]}>`};
  let logId:string | undefined;
  try {
    const cf=config.provider==='cloudflare'?await cloudflareFor(tenant!.cloudflare_user_id):null;
    const row=await one<{id:string}>(`insert into delivery_log(tenant_id,mailbox_id,actor_id,request_key,request_hash,status,provider,message_id) values($1,$2,$3,$4,$5,'sending',$6,$7) returning id`,
      [tid,sender.id,actorId,mail.requestKey,createHmac('sha256',env.BETTER_AUTH_SECRET).update(inviteId).digest('hex'),config.provider,mail.messageId]);
    logId=row!.id;
    const result=cf?await sendCloudflare(mail,cf,tenant!.cloudflare_account_id):await sendGmail(mail,config.gmail_user!,open(config.credentials_enc!));
    await pool.query("update delivery_log set status='accepted',result=$2,message_id=$3 where id=$1",[logId,JSON.stringify(result),result.messageId??mail.messageId]);
    return { emailSent:result.accepted.length>0,deliveryError:result.accepted.length?null:'The provider rejected the invite. Share the link instead.' };
  } catch(err) {
    if(logId)await pool.query('update delivery_log set status=$2 where id=$1',[logId,err instanceof DeliveryError&&!err.uncertain?'failed':'unknown']).catch(()=>undefined);
    return { emailSent:false,deliveryError:'Email delivery could not be confirmed. The invite is ready; share its link instead.' };
  }
}
