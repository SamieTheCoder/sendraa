import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAuthClient } from 'better-auth/client';
import { androidFingerprints, androidPasskeyOrigins } from '../src/android-association.js';

process.env.NODE_ENV='test';process.env.ALLOW_DEV_ADMIN_SIGNUP='true';
process.env.CLOUDFLARE_CLIENT_ID='';process.env.CLOUDFLARE_CLIENT_SECRET='';
process.env.BETTER_AUTH_URL='http://localhost:8787';
process.env.PASSKEY_RP_ID='api-dev.sendraa.tech';
process.env.APPLE_APP_ID='PT8JN7TFSB.com.scientific-samie.sendraa';
const testFingerprint = Array.from({length:32},(_,i)=>i.toString(16).padStart(2,'0')).join(':');
process.env.ANDROID_SHA256_FINGERPRINTS = ` ${testFingerprint},${testFingerprint.toUpperCase()} `;
const {app}=await import('../src/app.js');
const {pool}=await import('../src/db.js');
const jar=new Map<string,string>();const users:string[]=[];let count=0;
const check=(label:string,ok:unknown)=>{assert.ok(ok,label);count++;console.log(`PASS ${label}`);};
async function call(path:string,body?:unknown,cookies=jar) {
  const response=await app.request(`http://localhost:8787/api/auth${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin:'http://localhost:8787',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});
  for(const cookie of response.headers.getSetCookie()) {
    const pair=cookie.split(';')[0]!;const index=pair.indexOf('=');
    if(/max-age=0/i.test(cookie))cookies.delete(pair.slice(0,index));else cookies.set(pair.slice(0,index),pair.slice(index+1));
  }
  return {status:response.status,body:await response.json() as any};
}
try {
  check('remember endpoint requires authentication',(await call('/multi-session/remember',{},new Map())).status===401);
  const suffix=randomUUID();
  const a=await call('/sign-up/email',{email:`multi-a-${suffix}@example.invalid`,name:'Account A',password:'test-password-very-long'});
  assert.equal(a.status,200);users.push(a.body.user.id);
  // Simulate an existing login created before multi-session was enabled.
  for(const name of jar.keys())if(name.includes('_multi-'))jar.delete(name);
  check('old login can be enrolled without a password',(await call('/multi-session/remember',{})).status===200);
  const old=await call('/multi-session/list-device-sessions');
  check('enrolled session appears once',old.body.length===1&&old.body[0].user.id===users[0]);
  const tokenA=old.body[0].session.token;
  // Unlike the generic call helper, use Better Fetch itself to generate JSON headers.
  const nativeClient=createAuthClient({baseURL:'http://localhost:8787',fetchOptions:{customFetchImpl:async(input,init)=>app.request(String(input),init)}});
  const remember=await nativeClient.$fetch('/multi-session/remember',{method:'POST',body:{},headers:{origin:'http://localhost:8787',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')}});
  check('client remember request supplies JSON content type',!remember.error&&Boolean(remember.data));

  const b=await call('/sign-up/email',{email:`multi-b-${suffix}@example.invalid`,name:'Account B',password:'test-password-very-long'});
  assert.equal(b.status,200);users.push(b.body.user.id);
  const list=await call('/multi-session/list-device-sessions');
  check('two logins remain signed in',list.body.length===2);
  check('second login becomes active',(await call('/get-session')).body.user.id===users[1]);
  const tokenB=list.body.find((s:any)=>s.user.id===users[1]).session.token;
  check('cannot switch with a token from another cookie jar',(await call('/multi-session/set-active',{sessionToken:tokenA},new Map())).status===401);
  check('switching returns the selected identity',(await call('/multi-session/set-active',{sessionToken:tokenA})).body.user.id===users[0]);
  check('active cookie changes to selected account',(await call('/get-session')).body.user.id===users[0]);
  const options=await call('/passkey/generate-register-options');
  check('authenticated registration returns configured RP and challenge',options.status===200&&options.body.rp.id==='api-dev.sendraa.tech'&&Boolean(options.body.challenge));
  check('registration requires a session',(await call('/passkey/generate-register-options',undefined,new Map())).status===401);
  check('malformed passkey cannot establish a session',(await call('/passkey/verify-authentication',{response:{}},new Map())).status>=400);
  check('revoking active login succeeds',(await call('/multi-session/revoke',{sessionToken:tokenA})).status===200);
  check('remaining account stays signed in',(await call('/get-session')).body.user.id===users[1]);
  check('revoked account cannot be reactivated',(await call('/multi-session/set-active',{sessionToken:tokenA})).status===401);
  check('device list removes revoked login',(await call('/multi-session/list-device-sessions')).body.length===1);
  await pool.query('delete from session where token=$1',[tokenB]);
  check('server-revoked session cannot be reactivated',(await call('/multi-session/set-active',{sessionToken:tokenB})).status===401);
  check('stale sessions disappear from switcher',(await call('/multi-session/list-device-sessions')).body.length===0);
  const aasa=await (await app.request('http://localhost:8787/.well-known/apple-app-site-association')).json();
  check('Apple association matches signed app',aasa.webcredentials.apps[0]===process.env.APPLE_APP_ID);
  const fingerprints=androidFingerprints(process.env.ANDROID_SHA256_FINGERPRINTS!);
  check('Android fingerprints normalize whitespace/case and deduplicate',fingerprints.length===1&&fingerprints[0]===testFingerprint.toUpperCase());
  assert.throws(()=>androidFingerprints('AA:BB'),/SHA-256/);
  assert.throws(()=>androidFingerprints('zz'.repeat(32)),/SHA-256/);
  check('empty Android configuration stays disabled',androidFingerprints(' , ').length===0);
  check('Android origin uses the certificate bytes',androidPasskeyOrigins(fingerprints)[0]===`android:apk-key-hash:${Buffer.from(Array.from({length:32},(_,i)=>i)).toString('base64url')}`);
  const dalResponse=await app.request('http://localhost:8787/.well-known/assetlinks.json');
  const dal=await dalResponse.json();
  check('Android association returns public JSON without redirects',dalResponse.status===200&&dalResponse.headers.get('content-type')?.includes('application/json'));
  check('Android association matches normalized certificate and package',dal[0].target.sha256_cert_fingerprints[0]===fingerprints[0]&&dal[0].target.package_name==='com.scientificsamie.sendraa');
  const providers=await (await app.request('http://localhost:8787/v1/auth/providers')).json();
  check('Android passkey availability reflects configured association',providers.passkey.android===true);
  for(const path of ['/', '/account/reset', '/legal/privacy']) {
    const response=await app.request(`http://localhost:8787${path}`);const html=await response.text();
    check(`branding and icons are discoverable on ${path}`,response.status===200&&html.includes('rel="apple-touch-icon"')&&html.includes('href="/favicon.ico"')&&html.includes('alt="">Sendraa'));
  }
  for(const path of ['/favicon.png','/apple-touch-icon.png','/assets/sendraa-logo.png']) {
    const response=await app.request(`http://localhost:8787${path}`);const bytes=Buffer.from(await response.arrayBuffer());
    check(`valid PNG served at ${path}`,response.status===200&&response.headers.get('content-type')==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  }
  const ico=Buffer.from(await (await app.request('http://localhost:8787/favicon.ico')).arrayBuffer());
  check('ICO directory points to complete embedded image',ico.readUInt16LE(2)===1&&ico.readUInt32LE(14)===ico.length-22&&ico.readUInt32LE(18)===22);
  console.log(`${count} account-switching and passkey checks passed. No email sent.`);
} finally {
  for(const id of users)await pool.query('delete from "user" where id=$1',[id]);
  await pool.end();
}
