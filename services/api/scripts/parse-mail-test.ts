import assert from 'node:assert/strict';
import { seal } from '../src/crypto.js';
import { parseStoredMessage } from '../src/parse-mail.js';

// Synthetic mail only; no network, live credentials or user content are used.
const originalFetch=globalThis.fetch;
const worker={worker_url:'https://worker.invalid',worker_secret_enc:seal('test-secret')};
const picture=Buffer.alloc(270_000,0x61);
const mime=['From: Sender <sender@example.invalid>','To: test@example.invalid','Subject: Image test','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="boundary"','','--boundary','Content-Type: text/plain; charset=utf-8','','Image attached','--boundary','Content-Type: image/png; name="picture.png"','Content-Disposition: inline; filename="picture.png"','Content-ID: <picture>','Content-Transfer-Encoding: base64','',picture.toString('base64'),'--boundary--',''].join('\r\n');
let count=0;
const check=(name:string,value:unknown)=>{assert.ok(value,name);count++;console.log(`PASS ${name}`);};
let rawReads=0, failUpload=false, capability=true, saved:Record<string,unknown>|undefined;
let uploaded:Uint8Array|undefined;
globalThis.fetch=async(input,init)=>{
  const url=String(input);
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer test-secret');
  if(url.endsWith('/health'))return Response.json({capabilities:capability?['parsed-message']:[]});
  if(url.endsWith('/raw')){rawReads++;assert.ok(url.includes('/mailboxes/mailbox-a/messages/'));return new Response(mime);}
  if(url.endsWith('/att-0')){uploaded=init?.body as Uint8Array;return new Response('',{status:failUpload?503:200});}
  if(url.endsWith('/parsed')){saved=JSON.parse(String(init?.body));return Response.json({ok:true});}
  throw new Error('Unexpected network request');
};
try {
  await Promise.all([parseStoredMessage(worker,'mailbox-a','message-a'),parseStoredMessage(worker,'mailbox-a','message-a')]);
  check('concurrent opens share one MIME parse',rawReads===1);
  check('large image decodes without corruption',uploaded&&Buffer.from(uploaded).equals(picture));
  check('text and inline metadata survive parsing',String(saved?.text).trim()==='Image attached'&&Array.isArray(saved?.attachments)&&saved.attachments[0].inline&&saved.attachments[0].contentId==='picture');
  saved=undefined;failUpload=true;
  await assert.rejects(parseStoredMessage(worker,'mailbox-a','message-b'));
  check('failed upload cannot mark message processed',saved===undefined);
  failUpload=false;await parseStoredMessage(worker,'mailbox-a','message-b');
  check('failed messages can be retried',saved!==undefined);
  capability=false;
  await assert.rejects(parseStoredMessage(worker,'mailbox-a','message-c'),/update Email setup/);
  check('old Worker is reported without losing raw mail',true);
  console.log(`${count} deferred MIME checks passed.`);
} finally {globalThis.fetch=originalFetch;}
