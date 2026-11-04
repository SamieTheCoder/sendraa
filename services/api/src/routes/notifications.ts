import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { one, pool, transaction } from '../db.js';
import { body, requireSession, uuid, type AppEnv } from '../http.js';
import { authorize, IamError, resolveResource } from '../iam/policy.js';
import { mailboxResource } from '../iam/roles.js';
import { notificationMessage } from '../push.js';

export const notifications = new Hono<AppEnv>();
notifications.use('*',requireSession);
notifications.use('*',bodyLimit({maxSize:4096}));
notifications.put('/devices/:id',async(c)=>{
  const deviceId=uuid.safeParse(c.req.param('id'));
  if(!deviceId.success)throw new IamError(400,'INVALID_DEVICE','Invalid device identifier.');
  const input=await body(c,z.object({token:z.string().max(256).regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),platform:z.enum(['ios','android']),preference:z.enum(['all','important','none']),copyOtp:z.boolean()}).strict());
  const session=c.get('session');
  await transaction(async(db)=>{
    await db.query('select id from "user" where id=$1 for update',[session.user.id]);
    const count=await one<{n:number}>('select count(*)::int as n from push_device where user_id=$1 and id<>$2',[session.user.id,deviceId.data],db);
    if((count?.n ?? 0)>=10)throw new IamError(429,'DEVICE_LIMIT','Remove an old session in Account security before enabling another device.');
    // A token represents one installation: signing into another account transfers it.
    await db.query('delete from push_device where token=$1 and id<>$2',[input.token,deviceId.data]);
    await db.query(`insert into push_device(id,user_id,session_id,token,platform,preference,copy_otp) values($1,$2,$3,$4,$5,$6,$7)
      on conflict(id) do update set user_id=excluded.user_id,session_id=excluded.session_id,token=excluded.token,platform=excluded.platform,preference=excluded.preference,copy_otp=excluded.copy_otp,updated_at=now()`,
    [deviceId.data,session.user.id,session.session.id,input.token,input.platform,input.preference,input.copyOtp]);
  });
  return c.json({ok:true});
});
notifications.delete('/devices/:id',async(c)=>{
  const parsed=uuid.safeParse(c.req.param('id'));
  if(parsed.success)await pool.query('delete from push_device where id=$1 and user_id=$2',[parsed.data,c.get('session').user.id]);
  return c.json({ok:true});
});
notifications.get('/tenants/:tid/mailboxes/:mid/threads/:threadId/messages/:messageId/otp',async(c)=>{
  const ids=z.object({tid:uuid,mid:uuid,threadId:uuid,messageId:uuid}).safeParse(c.req.param());
  if(!ids.success)throw new IamError(404,'NOT_FOUND','Message not found.');
  const {tid,mid,threadId,messageId}=ids.data;
  await authorize(c.get('session').user.id,'mail.read',await resolveResource(mailboxResource(tid,mid),tid));
  c.header('Cache-Control','private, no-store');
  // Only recent signed inbound events qualify, not arbitrary old numbers in a conversation.
  const event=await one("select 1 from push_event where tenant_id=$1 and mailbox_id=$2 and thread_id=$3 and message_id=$4 and created_at>now()-interval '15 minutes'",[tid,mid,threadId,messageId]);
  if(!event)throw new IamError(404,'OTP_EXPIRED','This notification is too old. Open the message to check its code.');
  let detail;
  try { detail=await notificationMessage({tenantId:tid,mailboxId:mid,threadId,messageId}); }
  catch { throw new IamError(502,'MAIL_UNAVAILABLE','Could not read this message. Try again.'); }
  if(!detail.code)throw new IamError(404,'OTP_NOT_FOUND','No single verification code was found. Open the message to check it.');
  return c.json({code:detail.code});
});
