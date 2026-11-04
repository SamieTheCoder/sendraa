import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import nodemailer from 'nodemailer';
import { CloudflareApi, CloudflareApiError } from '@sendraa/cloudflare';
import { DeliveryError, rawMessage, sendCloudflare, sendGmail, sendInput, type Outbound } from '../src/sending-provider.js';

// Uses isolated fixtures in LOCAL development Postgres. All provider and Worker HTTP is mocked.
const database = new URL(process.env.DATABASE_URL!);
if (!['localhost','127.0.0.1'].includes(database.hostname)) throw new Error('Tests require a local development database.');
process.env.NODE_ENV='test'; process.env.ALLOW_DEV_ADMIN_SIGNUP='true';
process.env.CLOUDFLARE_CLIENT_ID=''; process.env.CLOUDFLARE_CLIENT_SECRET='';
process.env.BETTER_AUTH_URL='http://localhost:8787';
const { app }=await import('../src/app.js');
const { auth }=await import('../src/auth.js');
const { pool }=await import('../src/db.js');
const { seal }=await import('../src/crypto.js');
const originalFetch=globalThis.fetch;
const getAccessToken=auth.api.getAccessToken;
(auth.api as {getAccessToken:unknown}).getAccessToken=async()=>({accessToken:'fake-test-token'});
let sendCount=0;let failCopy=false;let uncertain=false;let rejected=false;let failSync=false;
let outdatedWorker=false;
const synced=new Set<string>();const copies=new Map<string,unknown>();
globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url.startsWith('https://worker.test/')) {
    const path=new URL(url).pathname;
    if(path==='/v1/health')return Response.json({ok:true,capabilities:outdatedWorker?[]:['outbound']});
    if(/\/mailboxes\/[\w-]+$/.test(path)) { if(failSync)return new Response('',{status:503});synced.add(path.split('/').at(-1)!);return Response.json({ok:true}); }
    if(path.includes('/threads/'))return Response.json({messages:[{messageId:'incoming@example.invalid',references:[]}]});
    if(path.includes('/outbound/')){if(failCopy)return new Response('',{status:503});if(!path.endsWith('/raw')&&!/att-\d+$/.test(path))copies.set(path,JSON.parse(String(init?.body)));return Response.json({threadId:path.split('/')[5]});}
    throw new Error('Unexpected Worker request');
  }
  if(url.startsWith('https://api.cloudflare.com/client/v4/')) {
    if(url.endsWith('/subdomains'))return Response.json({success:true,result:[{name:domainName,enabled:true}],errors:[]});
    if(url.endsWith('/send')) {
      sendCount++; if(uncertain)throw new Error('Simulated lost response');
      if(rejected)return Response.json({success:false,errors:[{code:10202,message:'Rejected test'}],result:null},{status:400});
      const payload=JSON.parse(String(init?.body));assert.equal(payload.headers['Message-ID'],undefined,'Cloudflare must own Message-ID');
      return Response.json({success:true,result:{delivered:payload.to.map((a:{address:string})=>a.address),queued:[],permanent_bounces:[],message_id:'<cf-test@example.invalid>'},errors:[]});
    }
    throw new Error('Unexpected Cloudflare request');
  }
  throw new Error('Tests forbid external network requests');
};
let passed=0;
function check(name:string,value:unknown){assert.ok(value,name);passed++;console.log(`PASS ${name}`);}
const suffix=randomUUID(); const domainName=`${suffix}.invalid`;const userIds:string[]=[];let tid:string|undefined;
const cookies=new Map<string,string>();
async function call(path:string,body?:unknown,method=body===undefined?'GET':'POST',cookie=true){
  const res=await app.request(`http://localhost:8787${path}`,{method,headers:{'content-type':'application/json',origin:'http://localhost:8787',...(cookie?{cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(cookie)for(const value of res.headers.getSetCookie()){const pair=value.split(';')[0]!;cookies.set(pair.slice(0,pair.indexOf('=')),pair.slice(pair.indexOf('=')+1));}
  return {status:res.status,body:await res.json() as Record<string,any>};
}
try {
  const user=await call('/api/auth/sign-up/email',{name:'Sending test',email:`owner-${suffix}@example.invalid`,password:'local-test-password-long'});assert.equal(user.status,200);const uid=user.body.user.id as string;userIds.push(uid);
  tid=(await pool.query('insert into tenant(name,created_by,setup_status,worker_url,worker_secret_enc,cloudflare_account_id,cloudflare_user_id) values($1,$2,$3,$4,$5,$6,$2) returning id',['Sending test',uid,'ready','https://worker.test',seal('test-only'),'a'.repeat(32)])).rows[0].id;
  await pool.query('insert into tenant_member(tenant_id,user_id) values($1,$2)',[tid,uid]);
  await pool.query('insert into iam_binding(tenant_id,resource,role,user_id) values($1,$2,$3,$4)',[tid,`tenants/${tid}`,'roles/owner',uid]);
  await pool.query('insert into account(id,"accountId","providerId","userId","createdAt","updatedAt") values($1,$2,$3,$4,now(),now())',[randomUUID(),'test-cloudflare','cloudflare',uid]);
  const did=(await pool.query('insert into domain(tenant_id,name,zone_id,verified_at) values($1,$2,$3,now()) returning id',[tid,domainName,'b'.repeat(32)])).rows[0].id;
  const base=`/v1/tenants/${tid}`;
  check('sending requires a session',(await call(`${base}/sending`,undefined,'GET',false)).status===401);
  const created=await call(`${base}/mailboxes`,{localPart:'team',domainId:did,displayName:'Team',shared:true});assert.equal(created.status,201);
  const mid=created.body.id as string;check('new mailbox is provisioned into tenant Worker',synced.has(mid)&&created.body.active);
  check('cross-tenant domain cannot create mailbox',(await call(`${base}/mailboxes`,{localPart:'foreign',domainId:randomUUID()})).status===404);
  failSync=true;const pending=await call(`${base}/mailboxes`,{localPart:'pending',domainId:did});check('failed mailbox sync preserves retryable registry',pending.status===201&&!pending.body.active);failSync=false;
  check('mailbox activation can be retried',(await call(`${base}/mailboxes/${pending.body.id}/activate`,{})).status===200);
  check('Cloudflare setup probes domain sending',(await call(`${base}/sending`,{provider:'cloudflare'},'PUT')).status===200);
  const settings=await call(`${base}/sending`);check('sending settings never expose encrypted credentials',!('credentials_enc' in settings.body.config));
  const message={requestKey:'first',to:[{address:'recipient@example.invalid',name:'Recipient'}],subject:'Test',text:'Hello',attachments:[{name:'note.txt',type:'text/plain',content:Buffer.from('attachment').toString('base64')}]};
  const sendPath=`${base}/mailboxes/${mid}/send`;
  outdatedWorker=true;
  const outdated=await call(sendPath,message);
  check('old Worker blocks before provider delivery',outdated.status===409&&outdated.body.error?.code==='WORKER_UPDATE_REQUIRED'&&sendCount===0);
  outdatedWorker=false;
  check('invalid recipient is rejected',(await call(sendPath,{...message,to:[{address:'invalid'}]})).status===400);
  check('client cannot override From',(await call(sendPath,{...message,from:'spoof@example.invalid'})).status===400);
  check('cross-tenant mailbox is denied',(await call(`${base}/mailboxes/${randomUUID()}/send`,message)).status===404);
  const first=await call(sendPath,message);assert.equal(first.status,200,JSON.stringify(first.body));check('message accepted and Sent copy stored',sendCount===1&&copies.size===1);
  const copy=[...copies.values()][0] as Outbound;check('Sent copy records provider Message-ID',copy.messageId==='<cf-test@example.invalid>');
  const replay=await call(sendPath,message);check('repeat request does not send twice',replay.status===200&&sendCount===1);
  check('changed payload cannot reuse attempt key',(await call(sendPath,{...message,text:'Changed'})).status===409);
  failCopy=true;const retryMessage={...message,requestKey:'copy-retry'};const copyFailed=await call(sendPath,retryMessage);check('accepted delivery with failed storage is explicit',copyFailed.body.error?.code==='SENT_COPY_PENDING'&&sendCount===2);
  await pool.query('delete from sending_config where tenant_id=$1',[tid]);
  failCopy=false;check('retry saves Sent copy without redelivery or provider credentials',(await call(sendPath,retryMessage)).status===200&&sendCount===2);
  await pool.query("insert into sending_config(tenant_id,provider) values($1,'cloudflare')",[tid]);
  uncertain=true;const unknown={...message,requestKey:'unknown'};check('lost provider response is marked uncertain',(await call(sendPath,unknown)).body.error?.code==='SEND_UNKNOWN');uncertain=false;const before=sendCount;
  check('uncertain send is never automatically retried',(await call(sendPath,unknown)).status===409&&sendCount===before);
  rejected=true;const rejectedMessage={...message,requestKey:'reject'};check('known rejection is actionable',(await call(sendPath,rejectedMessage)).body.error?.code==='SEND_REJECTED');rejected=false;
  check('known rejected send can be retried',(await call(sendPath,rejectedMessage)).status===200);
  const concurrent={...message,requestKey:'concurrent'};const sendsBefore=sendCount;const together=await Promise.all([call(sendPath,concurrent),call(sendPath,concurrent)]);
  check('concurrent taps send exactly once',together.some((r)=>r.status===200)&&sendCount===sendsBefore+1);
  await pool.query("update iam_binding set role='roles/mailReader' where tenant_id=$1 and user_id=$2",[tid,uid]);
  check('reader cannot send',(await call(sendPath,{...message,requestKey:'reader'})).status===403);
  check('reader cannot create mailboxes',(await call(`${base}/mailboxes`,{localPart:'blocked',domainId:did})).status===403);
  check('reader sees canSend false',(await call(`${base}/mailboxes`)).body.mailboxes.every((m:{canSend:boolean})=>!m.canSend));
  check('reader cannot read provider settings',(await call(`${base}/sending`)).status===403);
  await pool.query("update iam_binding set role='roles/mailboxAdmin' where tenant_id=$1 and user_id=$2",[tid,uid]);
  check('mailbox manager sees metadata only',(await call(`${base}/mailboxes?manage=true`)).body.mailboxes.length===2&&(await call(`${base}/mailboxes`)).body.mailboxes.length===0);
  check('mailbox manager cannot grant self mail access',(await call(`${base}/mailboxes/${mid}/access`,{userId:uid,role:'roles/mailUser'},'PUT')).status===403);
  await pool.query("update iam_binding set role='roles/owner' where tenant_id=$1 and user_id=$2",[tid,uid]);
  const invite=await call(`${base}/invites`,{email:`member-${suffix}@example.invalid`,role:'roles/mailReader',resource:`tenants/${tid}/mailboxes/${mid}`,emailInvite:true});
  check('admin can email an invite through tenant provider',invite.status===201&&invite.body.emailSent);
  const token=String(invite.body.inviteUrl).split('/').at(-1)!;
  const accepted=await call('/v1/invites/accept',{token,name:'Invited member',password:'member-test-password-long'},'POST',false);check('invite creates an account with its own password',accepted.status===200);
  const member=(await pool.query('select id from "user" where email=$1',[`member-${suffix}@example.invalid`])).rows[0].id;userIds.push(member);
  check('admin can change mailbox access atomically',(await call(`${base}/mailboxes/${mid}/access`,{userId:member,role:'roles/mailUser'},'PUT')).status===200);
  const bindings=(await pool.query('select role from iam_binding where user_id=$1 and tenant_id=$2',[member,tid])).rows;
  check('access change replaces read-only role',bindings.length===1&&bindings[0].role==='roles/mailUser');
  check('invite link is single-use',(await call('/v1/invites/accept',{token,name:'Again',password:'member-test-password-long'},'POST',false)).status===404);
  const mail:Outbound={...sendInput.parse({...message,bcc:[{address:'hidden@example.invalid'}]}),from:{name:'Sender',address:'sender@example.invalid'},messageId:'<test@example.invalid>',date:new Date().toISOString(),inReplyTo:null,references:[]};
  const raw=(await rawMessage(mail)).toString();check('sender-only archived MIME preserves Bcc',/^Bcc:/mi.test(raw));check('MIME has Message-ID and attachment',raw.includes('Message-ID: <test@example.invalid>')&&raw.includes('note.txt'));
  check('MIME From and Reply-To use the mailbox address',/^From: Sender <sender@example.invalid>/mi.test(raw)&&/^Reply-To: Sender <sender@example.invalid>/mi.test(raw));
  const denied=new CloudflareApi('test');denied.post=async()=>{throw new CloudflareApiError('not entitled',403,[{code:10105,message:'not entitled'}]);};
  await assert.rejects(()=>sendCloudflare(mail,denied,'account'),(e:unknown)=>e instanceof DeliveryError&&!e.uncertain&&e.message.includes('not entitled'));passed++;
  denied.post=async()=>{throw new CloudflareApiError('malformed success',200,[]);};
  await assert.rejects(()=>sendCloudflare(mail,denied,'account'),(e:unknown)=>e instanceof DeliveryError&&e.uncertain);check('malformed successful provider response never permits blind retry',true);
  const originalTransport=nodemailer.createTransport;
  let smtpFailure: {code?:string;responseCode?:number}|null=null;
  let verifyFailure: {code?:string;responseCode?:number}|null=null;
  let lastSmtpPassword: string | undefined;
  let smtpFrom: string | undefined;
  let smtpReplyTo: string | undefined;
  const smtpMock=mock.method(nodemailer,'createTransport',(options: Record<string,unknown>)=>{
    if(options.host!=='smtp.gmail.com')return Reflect.apply(originalTransport,nodemailer,[options]);
    assert.equal(options.port,587);assert.equal(options.requireTLS,true);assert.equal(options.disableFileAccess,true);assert.equal(options.disableUrlAccess,true);
    lastSmtpPassword=(options.auth as {pass:string}).pass;
    return {verify:async()=>{if(verifyFailure)throw verifyFailure;return true;},close:()=>{},sendMail:async(options:{from:{address:string};replyTo:{address:string}})=>{smtpFrom=options.from.address;smtpReplyTo=options.replyTo.address;if(smtpFailure)throw smtpFailure;return {accepted:['recipient@example.invalid'],rejected:[],messageId:'<gmail-test@example.invalid>'};}};
  });
  try {
    const gmailConfig={provider:'gmail',user:'test@gmail.com',password:'abcdefghijklmnop',allowedFrom:[`team@${domainName}`]};
    await pool.query("update tenant set setup_status='not_started' where id=$1",[tid]);
    check('Gmail credentials can be saved before aliases or Worker setup',(await call(`${base}/sending`,{...gmailConfig,allowedFrom:[],user:' Test@Gmail.com ',password:'abcd efgh ijkl mnop'},'PUT')).status===200);
    check('pasted app-password spacing is normalized',lastSmtpPassword==='abcdefghijklmnop');
    const credentialsOnly=await call(`${base}/sending`);
    check('saved credentials are reported without exposing the password',credentialsOnly.body.config.hasPassword===true&&credentialsOnly.body.config.allowed_from.length===0&&!('credentials_enc' in credentialsOnly.body.config));
    await pool.query("update tenant set setup_status='ready' where id=$1",[tid]);
    check('saving credentials alone does not enable a sender',(await call(sendPath,{...message,requestKey:'no-alias'})).body.error?.code==='ALIAS_REQUIRED');
    check('alias settings can reuse the saved password',(await call(`${base}/sending`,{...gmailConfig,password:''},'PUT')).status===200&&lastSmtpPassword===gmailConfig.password);
    check('changing Google account requires its own password',(await call(`${base}/sending`,{...gmailConfig,user:'another@gmail.com',password:''},'PUT')).body.error?.code==='GMAIL_PASSWORD_REQUIRED');
    verifyFailure={code:'EAUTH',responseCode:535};
    check('verification reports rejected credentials',(await call(`${base}/sending`,gmailConfig,'PUT')).body.error?.code==='GMAIL_AUTH_FAILED');
    verifyFailure={code:'ETIMEDOUT'};
    check('SMTP connectivity failure is not blamed on the password',(await call(`${base}/sending`,gmailConfig,'PUT')).body.error?.code==='GMAIL_UNAVAILABLE');
    check('failed verification preserves saved settings',(await call(`${base}/sending`)).body.config.gmail_user==='test@gmail.com');
    verifyFailure=null;
    check('Gmail credentials can be verified without delivering a test email',(await call(`${base}/sending`,gmailConfig,'PUT')).status===200);
    const secret=(await pool.query('select credentials_enc from sending_config where tenant_id=$1',[tid])).rows[0].credentials_enc;
    check('Gmail password is encrypted at rest',secret&&!secret.includes(gmailConfig.password));
    check('Gmail alias must belong to this workspace',(await call(`${base}/sending`,{...gmailConfig,allowedFrom:['foreign@example.invalid']},'PUT')).status===400);
    check('Gmail only sends from explicitly enabled aliases',(await call(`${base}/mailboxes/${pending.body.id}/send`,{...message,requestKey:'alias-block'})).body.error?.code==='ALIAS_REQUIRED');
    check('Gmail path stores accepted message in Sent',(await call(sendPath,{...message,requestKey:'gmail'})).status===200);
    check('Gmail relay receives mailbox sender rather than SMTP login',smtpFrom===`team@${domainName}`&&smtpReplyTo===smtpFrom&&smtpFrom!=='test@gmail.com');
    smtpFailure={responseCode:535,code:'EAUTH'};await assert.rejects(()=>sendGmail(mail,'test@gmail.com','test'),(e:unknown)=>e instanceof DeliveryError&&!e.uncertain);check('SMTP auth rejection is safe to retry after correction',true);
    smtpFailure={code:'ECONNRESET'};await assert.rejects(()=>sendGmail(mail,'test@gmail.com','test'),(e:unknown)=>e instanceof DeliveryError&&e.uncertain);check('SMTP disconnect preserves uncertain delivery status',true);
  } finally { smtpMock.mock.restore(); }
  console.log(`${passed} sending and workspace checks passed. No external messages sent.`);
} finally {
  globalThis.fetch=originalFetch;(auth.api as {getAccessToken:unknown}).getAccessToken=getAccessToken;
  if(tid)await pool.query('delete from tenant where id=$1',[tid]);
  for(const uid of userIds)await pool.query('delete from "user" where id=$1',[uid]);
  await pool.end();
}
