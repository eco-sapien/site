import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {publicConfiguration,privateOutput,runAgent} from '../agent_workspace.mjs';
globalThis.window=globalThis;
vm.runInThisContext(await readFile(new URL('./mock_supabase.js',import.meta.url),'utf8'));
const mock=createSupabaseMock(),client=mock.sdk.createClient();
const config=publicConfiguration({
  ECOSAPIEN_SUPABASE_URL:mock.config.url,ECOSAPIEN_SUPABASE_PUBLISHABLE_KEY:mock.config.publishableKey,ECOSAPIEN_WORKSPACE_ID:mock.config.workspaceId
});
assert.throws(()=>publicConfiguration({ECOSAPIEN_SUPABASE_URL:config.url,ECOSAPIEN_WORKSPACE_ID:config.workspace,ECOSAPIEN_SUPABASE_PUBLISHABLE_KEY:'sb_secret_forbidden'}),/not accepted/);
const outputs=[],notices=[],io={out:message=>outputs.push(message),notice:message=>notices.push(message)};
const directory=await mkdtemp(join(tmpdir(),'ecosapien-agent-test-'));
try {
  await client.auth.signInWithPassword({email:'owner@example.test',password:'synthetic'});
  await assert.rejects(runAgent(client,config,'status',{},io),/dedicated workspace account/);
  await client.auth.signInWithPassword({email:'agent@example.test',password:'synthetic'});
  await runAgent(client,config,'status',{},io);
  assert.equal(JSON.parse(outputs.at(-1)).actor,'Application agent');
  const source=join(directory,'changes.json');
  await writeFile(source,JSON.stringify([{record_id:'trier-gemstones',field:'notes',value:'Agent draft'}]),{mode:0o600});
  const request='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  await runAgent(client,config,'save',{changes:source,request},io);
  await runAgent(client,config,'save',{changes:source,request},io);
  assert.equal(mock.state.activity.filter(a=>a.action==='progress_updated').length,1);
  assert.equal(mock.state.activity[0].actor_kind,'agent');
  await runAgent(client,config,'changes',{after:'0'},io);
  assert.equal(JSON.parse(outputs.at(-1)).events.length,1);
  assert.equal(JSON.parse(outputs.at(-1)).next_after,1);
  const doc=join(directory,'CV.pdf');await writeFile(doc,'%PDF-1.4\nPrivate synthetic CV',{mode:0o600});
  class NodeUpload extends mock.sdk.Upload {constructor(bytes,options){super(new Blob([bytes]),options);}}
  const id='cccccccc-cccc-4ccc-accc-cccccccccccc';
  await runAgent(client,config,'upload',{file:doc,record:'trier-gemstones',slot:'cv',id},io,NodeUpload);
  await runAgent(client,config,'upload',{file:doc,record:'trier-gemstones',slot:'cv',id},io,NodeUpload);
  assert.equal(mock.state.files.length,1);
  assert.equal(mock.state.files[0].actor_kind,'agent');
  const destination=join(directory,'downloaded.pdf');
  await runAgent(client,config,'download',{id,out:destination},io);
  assert.equal(await readFile(destination,'utf8'),'%PDF-1.4\nPrivate synthetic CV');
  assert.equal((await stat(destination)).mode&0o777,0o600);
  await assert.rejects(runAgent(client,config,'download',{id,out:destination},io),/EEXIST/);
  const privateSnapshot=join(directory,'snapshot.json');
  await runAgent(client,config,'snapshot',{out:privateSnapshot},io);
  assert.equal(JSON.parse(await readFile(privateSnapshot,'utf8')).files.length,1);
  await assert.rejects(privateOutput(new URL('../../private-test.json',import.meta.url).pathname,'private'),/outside the public website/);
  assert.equal((outputs.join('')+notices.join('')).includes('synthetic-session-only'),false);
  console.log('PASS dedicated agent identity, activity cursor, idempotent edits/uploads and private file IO');
} finally {await rm(directory,{recursive:true,force:true});}
