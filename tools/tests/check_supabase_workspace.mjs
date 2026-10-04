import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
globalThis.window=globalThis;
globalThis.location={href:'https://example.test/databases.html'};
for(const file of ['tools/tests/mock_supabase.js','assets/supabase-workspace.js']) {
  vm.runInThisContext(await readFile(new URL('../../'+file,import.meta.url),'utf8'));
}
const mock=createSupabaseMock();globalThis.EcoCloudSDK=mock.sdk;
const W=SupabaseWorkspace,config=mock.config;
assert.equal(W.validConfig(config),true);
assert.equal(W.validConfig({...config,publishableKey:'sb_secret_do_not_publish'}),false);
assert.equal(W.validConfig({...config,url:'https://exampleproject.supabase.co.evil.test'}),false);
assert.equal(W.validConfig({...config,workspaceId:'../../private'}),false);
const adminJwt=['e30',Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),'signature'].join('.');
assert.equal(W.validConfig({...config,publishableKey:adminJwt}),false);
assert.equal(W.validConfig({...config,publishableKey:['e30',Buffer.from(JSON.stringify({role:'anon'})).toString('base64url'),'signature'].join('.')}),true);
console.log('PASS public-only configuration; secret keys, foreign endpoints and invalid workspace IDs refused');

const events=[],w=new W(event=>events.push(event),config);
assert.equal(mock.options.auth.persistSession,false);
assert.equal(await w.start(),null);
await w.signIn('owner@example.test','synthetic-password');
assert.equal(w.connected,true);assert.equal(w.canEdit,true);assert.equal(w.canManage,true);
const batch={changes:[{record_id:'trier-gemstones',field:'notes',value:'Private draft'}]};
mock.failSave='after';await assert.rejects(w.save(batch),/lost save response/);
const request=batch.requestId;await w.save(batch);assert.equal(batch.requestId,request);
assert.equal(mock.state.activity.filter(a=>a.action==='progress_updated').length,1);
const state=await w.load();assert.equal(state.progress['trier-gemstones'].notes,'Private draft');
console.log('PASS memory-only session, shared snapshot, field saves and stable retry identifier');

const previous=structuredClone(mock.state);previous.member=structuredClone(mock.member);
const normalRpc=w.rpc.bind(w);let release;
w.rpc=(name,args,signal)=>name==='eco_snapshot'&&!release?new Promise(resolve=>{release=()=>resolve(previous);}):normalRpc(name,args,signal);
const staleLoad=w.load();
await w.save({changes:[{record_id:'trier-gemstones',field:'notes',value:'More recent save'}]});
await w.load();release();
assert.equal((await staleLoad).progress['trier-gemstones'].notes,'More recent save');
w.rpc=normalRpc;
console.log('PASS slow refresh cannot roll back a newer acknowledged save');

const controller=new AbortController(),file=new File(['%PDF-test'],'cv.pdf',{type:'application/pdf'});
const uploaded=await w.upload(file,{id:'trier-gemstones',key:'cv'},()=>{},controller.signal);
assert.equal(uploaded.record_id,'trier-gemstones');assert.equal(uploaded.slot,'cv');
await w.load();const downloaded=await w.download(uploaded.id);
assert.equal(await downloaded.blob.text(),'%PDF-test');assert.equal(downloaded.name,'cv.pdf');
assert.equal(mock.uploads[0].options.chunkSize,6*1024*1024);
assert.equal(mock.uploads[0].options.storeFingerprintForResuming,false);
assert.equal(mock.uploads[0].headers['x-upsert'],'false');
assert.equal(mock.uploads[0].headers.apikey,config.publishableKey);
assert.equal(mock.uploads[0].options.endpoint,'https://exampleproject.storage.supabase.co/storage/v1/upload/resumable');
await assert.rejects(w.upload(new File(['bad'],'evil.html'),{id:'trier-gemstones',key:'cv'},()=>{},controller.signal),/Choose a PDF/);
await assert.rejects(w.upload(new File([''],'empty.pdf'),{id:'trier-gemstones',key:'cv'},()=>{},controller.signal),/non-empty/);
const libraryFile=await w.upload(file,{id:'library',key:'transcript'},()=>{},controller.signal);
const libraryState=await w.load();assert.equal(libraryState.library.files.transcript,libraryFile.id);
assert.equal(mock.state.files.length,2);
console.log('PASS private upload destinations, original-byte download, shared library and no persistent TUS metadata');

mock.holdUpload=true;
const cancel=new AbortController(),pending=w.upload(file,{id:'trier-gemstones',key:'statement'},()=>{},cancel.signal);
await new Promise(resolve=>setTimeout(resolve,5));cancel.abort();
await assert.rejects(pending,error=>error.name==='AbortError');
assert.equal(mock.state.files.length,2);
const cancelled=mock.uploads.at(-1);cancelled.finish();assert.equal(mock.state.files.length,2);
mock.holdUpload=false;
mock.holdSnapshot=true;
const late=w.load();await new Promise(resolve=>setTimeout(resolve,5));
await w.signOut();mock.releaseSnapshot();
await assert.rejects(late,error=>error.name==='AbortError');
assert.equal(w.connected,false);assert.equal(w.files.size,0);assert.equal(w.meta,null);
console.log('PASS cancellation, sign-out clearing and late-response fencing');

mock.holdSnapshot=false;
await w.signIn('viewer@example.test','synthetic-password');
assert.equal(w.canEdit,false);await assert.rejects(w.save(batch),/read-only/);
assert.equal((await w.download(uploaded.id)).name,'cv.pdf');
mock.revoked=true;
await assert.rejects(w.load(),error=>error.accessDenied===true);
await w.signOut();mock.revoked=false;
const safe=W.applyChanges(W.empty(),[
  {record_id:'__proto__',field:'polluted',value:'yes'},
  {record_id:'library',field:'documents.__proto__.file_id',value:'yes'}
]);
assert.equal({}.polluted,undefined);assert.equal(Object.keys(safe.progress).length,0);
console.log('PASS viewer downloads, revoked membership errors and defensive state decoding');
