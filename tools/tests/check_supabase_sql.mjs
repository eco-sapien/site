import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Actual migrations run in PostgreSQL (WASM). The fixtures replace only the
// Supabase-managed Auth/Storage schemas, not the application functions or RLS.
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,storage,public to anon,authenticated;
  grant execute on function auth.uid() to anon,authenticated;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to anon,authenticated;
  create function public.rls_auto_enable() returns event_trigger language plpgsql security definer as $$ begin end $$;
  grant execute on function public.rls_auto_enable() to anon,authenticated;
`);
for (const file of ['20261006075729_shared_workspace.sql','20261006075737_documents_and_updates.sql']) {
  await db.exec(await readFile(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));
}
for (const role of ['anon','authenticated']) {
  assert.equal((await db.query("select has_function_privilege($1,'public.rls_auto_enable()','execute') as allowed",[role])).rows[0].allowed,false);
}
assert.ok((await db.query("select to_regprocedure('public.rls_auto_enable()') as helper")).rows[0].helper);
console.log('PASS administrative auto-RLS helper remains installed but cannot be called by website clients');
const workspace = randomUUID(), otherWorkspace = randomUUID();
const owner = randomUUID(), editor = randomUUID(), viewer = randomUUID(), stranger = randomUUID(), otherOwner = randomUUID(), agent = randomUUID();
for (const [id,email,confirmed] of [[owner,'owner@example.test',true],[editor,'editor@example.test',true],[viewer,'viewer@example.test',true],[stranger,'stranger@example.test',false],[otherOwner,'other@example.test',true],[agent,'agent@example.test',true]]) {
  await db.query('insert into auth.users values($1,$2,$3)', [id,email,confirmed ? new Date().toISOString() : null]);
}
await db.query('insert into public.eco_workspaces(id,name) values($1,$2),($3,$4)', [workspace,'Test workspace',otherWorkspace,'Other workspace']);
for (const [w,u,r,n] of [[workspace,owner,'owner','Owner'],[workspace,editor,'editor','Editor'],[workspace,viewer,'viewer','Viewer'],[otherWorkspace,otherOwner,'owner','Other owner']]) {
  await db.query('insert into public.eco_members(workspace_id,user_id,role,display_name) values($1,$2,$3,$4)',[w,u,r,n]);
}
async function as(user, sql, values = [], role = 'authenticated') {
  await db.exec('set role ' + role);
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
    return await db.query(sql, values);
  } finally { await db.exec('reset role'); }
}
const rpc = async (user, name, args) => (await as(user, `select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`, args)).rows[0].result;
const snapshot = (user = owner, w = workspace) => rpc(user,'eco_snapshot',[w]);
const save = (user, changes, id = randomUUID(), w = workspace) => rpc(user,'eco_save',[w,id,JSON.stringify(changes)]);
const change = (field,value,record_id='trier-gemstones') => ({record_id,field,value});

assert.equal((await as(null,'select * from public.eco_fields',[],'anon').catch(e=>e)).code,'42501');
assert.equal((await as(stranger,'select * from public.eco_workspaces')).rows.length,0);
await assert.rejects(snapshot(stranger),/permission/);
await assert.rejects(snapshot(owner,otherWorkspace),/permission/);
assert.equal((await as(owner,'select * from public.eco_workspaces')).rows.length,1);
await assert.rejects(as(owner,'select eco_private.actor($1,true)',[workspace]),/permission denied/);
await assert.rejects(as(owner,"insert into public.eco_activity(workspace_id,actor_name,actor_kind,action) values($1,'Someone else','agent','forged')",[workspace]),/permission denied/);
console.log('PASS anonymous, uninvited and cross-workspace access blocked; direct writes and attribution spoofing blocked');

const request = randomUUID();
await save(editor,[change('notes','Real notes'),change('saved',true)],request);
const afterSave = await snapshot();
assert.equal(afterSave.fields.find(f=>f.field==='notes').value,'Real notes');
assert.equal(afterSave.activity[0].actor_id,editor);
assert.equal(afterSave.activity[0].actor_name,'Editor');
assert.equal(afterSave.activity[0].actor_kind,'person');
await save(editor,[change('notes','Real notes'),change('saved',true)],request);
assert.equal((await snapshot()).activity.length,afterSave.activity.length);
await assert.rejects(save(editor,[change('notes','Different payload')],request),/different request/);
await assert.rejects(save(owner,[change('notes','Real notes'),change('saved',true)],request),/different request/);
await save(owner,[change('stage','Preparing')]);
assert.equal((await snapshot()).fields.find(f=>f.field==='notes').value,'Real notes');
await save(owner,[change('notes','New notes')]);
const conflict = (await snapshot()).activity[0].details.changes[0];
assert.equal(conflict.before,'Real notes'); assert.equal(conflict.after,'New notes');
await assert.rejects(save(viewer,[change('notes','No')]),/permission/);
assert.equal((await snapshot(viewer)).fields.find(f=>f.field==='notes').value,'New notes');
console.log('PASS field merge, idempotent retry, same-field history, actor attribution and viewer restrictions');

for (const bad of [change('stage','Invalid'),change('saved','true'),change('notes',null),change('documents.cv.file_id',randomUUID()),change('documents.cv.url','javascript:alert(1)'),change('documents.cv.url','https://drive.google.com.evil.test/file'),change('documents.cv.status','Complete'),change('deadline','2027-02-30'),change('deadline','1999-01-01'),change('notes','x','../../evil'),change('notes','x'.repeat(4001)),change('unknown','bad')]) {
  await assert.rejects(save(editor,[change('notes','Must roll back'),bad]));
  assert.equal((await snapshot()).fields.find(f=>f.field==='notes').value,'New notes');
}
await assert.rejects(save(editor,[change('stage','Preparing'),change('stage','Submitted')]),/Duplicate/);
await save(editor,[change('deadline','2028-02-29'),change('deadline_confirmed',true)]);
console.log('PASS validation is atomic; unsafe links, wrong file references, invalid dates and malformed fields rejected');

await assert.rejects(rpc(editor,'eco_invite_member',[workspace,'agent@example.test','Agent','editor','agent']),/Only the workspace owner/);
await rpc(owner,'eco_invite_member',[workspace,'stranger@example.test','Invited person','viewer','person']);
await assert.rejects(rpc(stranger,'eco_join_workspace',[workspace]),/Confirm your email/);
await db.query('update auth.users set email_confirmed_at=now() where id=$1',[stranger]);
await rpc(stranger,'eco_join_workspace',[workspace]);
assert.equal((await snapshot(stranger)).member.role,'viewer');
assert.equal((await snapshot(stranger)).invitations.length,0);
await assert.rejects(rpc(owner,'eco_invite_member',[workspace,'stranger@example.test','Duplicate','editor','person']),/already a member/);
await rpc(owner,'eco_invite_member',[workspace,'agent@example.test','Application agent','editor','agent']);
await rpc(agent,'eco_join_workspace',[workspace]);
await save(agent,[change('documents.statement.status','Draft')]);
assert.equal((await snapshot()).activity[0].actor_kind,'agent');
await assert.rejects(rpc(owner,'eco_set_member',[workspace,owner,'removed']),/owner account cannot/);
await rpc(owner,'eco_set_member',[workspace,stranger,'removed']);
await assert.rejects(snapshot(stranger),/permission/);
await assert.rejects(rpc(stranger,'eco_join_workspace',[workspace]),/not been invited/);
console.log('PASS verified invitations, owner-only member administration, agent attribution and revocation');

const file = randomUUID(), replacement = randomUUID();
const begin = (user,id,record='trier-gemstones',slot='cv',size=10) => rpc(user,'eco_begin_upload',[workspace,id,record,slot,'CV.pdf',size,'application/pdf']);
const finish = (user,id) => rpc(user,'eco_complete_upload',[workspace,id]);
const intent = await begin(editor,file);
assert.equal(intent.object_path,`${workspace}/trier-gemstones/cv/${file}`);
assert.equal((await begin(editor,file)).id,file);
assert.equal((await snapshot(owner)).pending_uploads.length,0);
assert.equal((await snapshot(editor)).pending_uploads.length,1);
await assert.rejects(begin(owner,file),/different file/);
await assert.rejects(begin(viewer,randomUUID()),/permission/);
await assert.rejects(begin(editor,randomUUID(),'trier-gemstones','cv',52428801),/50 MB/);
await assert.rejects(rpc(editor,'eco_begin_upload',[workspace,randomUUID(),'trier-gemstones','cv','malware.html',10,'text/html']),/supported document/);
await assert.rejects(finish(editor,file),/not complete/);
const uploadSql="insert into storage.objects(bucket_id,name,metadata) values('application-documents',$1,$2) returning id";
const metadata=JSON.stringify({size:10,mimetype:'application/pdf'});
await assert.rejects(as(owner,uploadSql,[intent.object_path,metadata]),/row-level security/);
await assert.rejects(as(editor,uploadSql,[`${workspace}/trier-gemstones/cv/unknown`,metadata]),/row-level security/);
await as(editor,uploadSql,[intent.object_path,metadata]);
assert.equal((await as(owner,'select * from storage.objects')).rows.length,0);
assert.equal((await as(editor,'select * from storage.objects')).rows.length,1);
await assert.rejects(finish(owner,file),/another account/);
await finish(editor,file);
await finish(editor,file); // A lost response can be retried without a new version/activity entry.
assert.equal((await snapshot()).activity.filter(a=>a.file_id===file).length,1);
assert.equal((await snapshot()).fields.find(f=>f.field==='documents.cv.file_id').value,file);
assert.equal((await snapshot()).fields.find(f=>f.field==='documents.cv.status').value,'Ready');
assert.equal((await as(viewer,'select * from storage.objects')).rows.length,1);
assert.equal((await as(otherOwner,'select * from storage.objects')).rows.length,0);
assert.equal((await as(null,'select * from storage.objects',[],'anon')).rows.length,0);
console.log('PASS upload intent, private paths, binary attachment checks, recovery retry and authorised downloads');

const newer = await begin(editor,replacement);
await as(editor,uploadSql,[newer.object_path,metadata]); await finish(editor,replacement);
assert.equal((await snapshot()).files.length,2);
assert.equal((await snapshot()).fields.find(f=>f.field==='documents.cv.file_id').value,replacement);
assert.equal((await as(editor,'delete from storage.objects returning id')).rows.length,0);
assert.equal((await as(editor,"update storage.objects set metadata='{}' returning id")).rows.length,0);
await assert.rejects(as(editor,uploadSql,[intent.object_path,metadata]),/row-level security/);
await save(owner,[change('documents.cv.file_id',file)]);
await assert.rejects(save(editor,[change('documents.statement.file_id',file)]),/does not belong/);
await assert.rejects(save(otherOwner,[change('documents.cv.file_id',file)],randomUUID(),otherWorkspace),/does not belong/);
const badSize=randomUUID(), sizeIntent=await begin(editor,badSize);
await as(editor,uploadSql,[sizeIntent.object_path,JSON.stringify({size:9,mimetype:'application/pdf'})]);
await assert.rejects(finish(editor,badSize),/size did not match/);
const badMime=randomUUID(), mimeIntent=await begin(editor,badMime);
await as(editor,uploadSql,[mimeIntent.object_path,JSON.stringify({size:10,mimetype:'text/plain'})]);
await assert.rejects(finish(editor,badMime),/type did not match/);
await rpc(owner,'eco_set_member',[workspace,editor,'removed']);
assert.equal((await as(editor,'select * from storage.objects')).rows.length,0);
await assert.rejects(finish(editor,badSize),/permission/);
await assert.rejects(save(editor,[change('notes','revoked')]),/permission/);
assert.equal((await db.query("select public from storage.buckets where id='application-documents'")).rows[0].public,false);
console.log('PASS immutable versions, previous-version selection, workspace/slot boundaries and revoked-member isolation');
const bootstrapId=randomUUID();
const bootstrap=(await readFile(new URL('../../supabase/bootstrap-owner.example.sql',import.meta.url),'utf8'))
  .replace('__WORKSPACE_UUID__',bootstrapId).replace('__OWNER_EMAIL__','bootstrap@example.test');
await db.exec(bootstrap);await db.exec(bootstrap);
const invitation=(await db.query('select * from public.eco_invitations where workspace_id=$1',[bootstrapId])).rows;
assert.equal(invitation.length,1);assert.equal(invitation[0].role,'owner');
console.log('PASS private owner bootstrap creates a single reserved owner invitation');
await db.close();
