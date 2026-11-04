import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const workerRequire=createRequire(new URL('../../../workers/sendraa-mail/package.json',import.meta.url));
const {build}=workerRequire('esbuild');
const result=await build({entryPoints:[new URL('../src/mail/store.ts',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',write:false,plugins:[{
  name:'test-storage',setup(builder){
    builder.onResolve({filter:/^(react|\.\/persistence)$/},(args)=>({path:args.path,namespace:'test'}));
    builder.onLoad({filter:/.*/,namespace:'test'},(args)=>({contents:args.path==='react'?'export const useSyncExternalStore=()=>{throw new Error("Hooks are not used by this store test")};':'const data=new Map(); export const mailStorage={getItemSync:k=>data.get(k)??null,setItemSync:(k,v)=>data.set(k,v)};'}));
  },
}]});
const store=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
store.activateMailIdentity('user-a');
assert.equal(store.getMail().threads.length,0,'new login does not see legacy/sample mail');
store.applyFromServer((s)=>({...s,drafts:[{id:'draft-a',body:'Private draft A'}],recentSearches:['private A']}));
store.activateMailIdentity('user-b');
assert.equal(store.getMail().drafts.length,0,'second login cannot see first login draft');
assert.deepEqual(store.getMail().recentSearches,[],'search history is isolated');
store.applyFromServer((s)=>({...s,drafts:[{id:'draft-b',body:'Private draft B'}]}));
store.activateMailIdentity('user-a');
assert.equal(store.getMail().drafts[0].id,'draft-a','first draft restored after account switch');
assert.equal(store.getMail().drafts.length,1,'second account draft does not leak');
store.activateMailIdentity(null);
assert.equal(store.getMail().drafts.length,0,'sign-out clears visible drafts');
store.activateMailIdentity('user-b');
assert.equal(store.getMail().drafts[0].id,'draft-b','other account keeps its own draft');
console.log('7 account cache isolation checks passed. No real storage accessed.');
