#!/usr/bin/env node
// A dedicated Auth member tagged "agent"; never an administrator/service key.
import {createClient} from '@supabase/supabase-js';
import {Upload} from 'tus-js-client';
import {readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,basename,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node --env-file=/private/agent.env tools/agent_workspace.mjs\n'+
  '  status\n  changes [--after ACTIVITY_ID] [--out /private/changes.json]\n'+
  '  snapshot --out /private/workspace.json\n'+
  '  save --changes /private/changes.json [--request UUID]\n'+
  '  upload --record PROGRAMME_ID_OR_library --slot cv --file /private/CV.pdf [--id UUID]\n'+
  '  download --id FILE_UUID --out /private/CV.pdf\n';
const uuid=value=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value||'');
const types={
  pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt:'application/vnd.oasis.opendocument.text',rtf:'application/rtf',txt:'text/plain',
  ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp:'application/vnd.oasis.opendocument.presentation',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',zip:'application/zip'
};
const slots=new Set(['cv','statement','portfolio','degree','transcript','language','aps','reference','employment']);
const required=(args,key)=>{if(!args[key])throw new Error('Missing --'+key);return args[key];};
const checked=result=>{if(result.error)throw new Error(result.error.message);return result.data;};

export function publicConfiguration(env) {
  const url=env.ECOSAPIEN_SUPABASE_URL||'',key=env.ECOSAPIEN_SUPABASE_PUBLISHABLE_KEY||'',workspace=env.ECOSAPIEN_WORKSPACE_ID||'';
  let publicKey=/^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  try{publicKey ||= key.split('.').length===3&&JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon';}catch{/* Invalid legacy key. */}
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)||!uuid(workspace)||!publicKey)throw new Error('Set the project URL, workspace UUID and public publishable/anon key. Secret and service-role keys are not accepted.');
  return {url:url.replace(/\/$/,''),key,workspace};
}

export async function privateOutput(path,contents) {
  if(!path||!path.startsWith('/'))throw new Error('Use an absolute --out path outside the public website.');
  const parent=await realpath(dirname(resolve(path))),destination=resolve(parent,basename(path));
  if(destination===root||destination.startsWith(root+sep))throw new Error('Private exports must be written outside the public website repository.');
  await writeFile(destination,contents,{flag:'wx',mode:0o600});
  return destination;
}

export async function runAgent(client,config,command,args,io={out:console.log,notice:console.error},Uploader=Upload) {
  const rpc=async(name,parameters={})=>checked(await client.rpc(name,{p_workspace:config.workspace,...parameters}));
  const member=await rpc('eco_join_workspace');
  if(member.actor_kind!=='agent')throw new Error('Use a dedicated workspace account tagged Agent, not a person’s account.');
  const output=async data=>{
    const text=JSON.stringify(data,null,2)+'\n';
    if(args.out){await privateOutput(args.out,text);io.out('Private export saved.');}else io.out(text);
  };
  if(command==='status') {
    const snapshot=await rpc('eco_snapshot');
    await output({workspace:snapshot.workspace.name,actor:member.display_name,role:member.role,files:snapshot.files.length,latest_activity_id:snapshot.activity[0]?.id??null,recent_activity:snapshot.activity.slice(0,10)});
  } else if(command==='changes') {
    if(args.after&&!/^\d+$/.test(args.after))throw new Error('--after must be a numeric activity ID.');
    let query=client.from('eco_activity').select('*').eq('workspace_id',config.workspace).order('id',{ascending:true}).limit(200);
    if(args.after)query=query.gt('id',args.after);
    const rows=checked(await query);
    await output({events:rows,next_after:rows.at(-1)?.id??args.after??null,limit:200});
  } else if(command==='snapshot') {
    required(args,'out');await output(await rpc('eco_snapshot'));
  } else if(command==='save') {
    const info=await stat(required(args,'changes'));
    if(info.size>6*1024*1024)throw new Error('The change list must be smaller than 6 MB.');
    const changes=JSON.parse(await readFile(args.changes,'utf8'));
    if(!Array.isArray(changes)||!changes.length)throw new Error('Use a JSON array of {record_id,field,value} changes.');
    const request=args.request||randomUUID();
    if(!uuid(request))throw new Error('--request must be a UUID.');
    io.notice('Save request ID: '+request+' (reuse this ID and the same payload if the response is lost).');
    await output({request_id:request,...await rpc('eco_save',{p_request:request,p_changes:changes})});
  } else if(command==='download') {
    const id=required(args,'id');required(args,'out');
    if(!uuid(id))throw new Error('--id must be a file UUID.');
    const file=checked(await client.from('eco_files').select('*').eq('workspace_id',config.workspace).eq('id',id).eq('status','ready').single());
    const blob=checked(await client.storage.from('application-documents').download(file.object_path));
    await privateOutput(args.out,Buffer.from(await blob.arrayBuffer()));io.out('Private document downloaded.');
  } else if(command==='upload') {
    const input=required(args,'file'),record=required(args,'record'),slot=required(args,'slot'),name=basename(input),mime=types[name.split('.').at(-1).toLowerCase()];
    if(!slots.has(slot)||!(record==='library'||record.length<=100&&/^[a-z0-9]+(-[a-z0-9]+)+$/.test(record)))throw new Error('Use a known programme ID (or library) and document slot.');
    const info=await stat(input);
    if(!mime||!info.isFile()||!info.size||info.size>50*1024*1024)throw new Error('Choose a supported non-empty document no larger than 50 MB.');
    const id=args.id||randomUUID();if(!uuid(id))throw new Error('--id must be a UUID.');
    io.notice('Upload ID: '+id+' (reuse with the same file to recover a completed upload).');
    const intent=await rpc('eco_begin_upload',{p_file:id,p_record:record,p_slot:slot,p_name:name,p_size:info.size,p_mime:mime});
    if(intent.status==='ready'){await output(intent);return;}
    // Retry a previously uploaded file without creating another object/version.
    if(args.id){
      const completion=await client.rpc('eco_complete_upload',{p_workspace:config.workspace,p_file:id});
      if(!completion.error){await output(completion.data);return;}
      if(completion.error.code==='42501')throw new Error(completion.error.message);
    }
    const bytes=await readFile(input);
    await new Promise((resolveUpload,reject)=>{
      const upload=new Uploader(bytes,{
        endpoint:config.url.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable',
        chunkSize:6*1024*1024,uploadSize:bytes.length,uploadDataDuringCreation:true,
        retryDelays:[0,1000,3000,5000,10000],storeFingerprintForResuming:false,
        metadata:{bucketName:'application-documents',objectName:intent.object_path,contentType:mime,cacheControl:'0'},
        onBeforeRequest:async request=>{
          const {session}=checked(await client.auth.getSession());
          if(!session)throw new Error('The agent session ended.');
          request.setHeader('Authorization','Bearer '+session.access_token);
          request.setHeader('apikey',config.key);request.setHeader('x-upsert','false');
        },
        onError:()=>reject(new Error('Upload failed. Retry with the printed upload ID; no existing document was replaced.')),
        onSuccess:resolveUpload
      });
      upload.start();
    });
    await output(await rpc('eco_complete_upload',{p_file:id}));
  } else throw new Error(usage);
}

async function main() {
  const [command,...rest]=process.argv.slice(2);
  if(!command||command==='--help'){console.log(usage);return;}
  if(!['status','changes','snapshot','save','upload','download'].includes(command))throw new Error(usage);
  const args=Object.create(null);
  for(let i=0;i<rest.length;i+=2){
    if(!/^--[a-z]+$/.test(rest[i])||!rest[i+1]||rest[i+1].startsWith('--'))throw new Error(usage);
    args[rest[i].slice(2)]=rest[i+1];
  }
  const config=publicConfiguration(process.env);
  if(!process.env.ECOSAPIEN_AGENT_EMAIL||!process.env.ECOSAPIEN_AGENT_PASSWORD)throw new Error('Set the dedicated agent email and password in a private environment file, never command arguments or the repository.');
  const client=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  checked(await client.auth.signInWithPassword({email:process.env.ECOSAPIEN_AGENT_EMAIL,password:process.env.ECOSAPIEN_AGENT_PASSWORD}));
  try {await runAgent(client,config,command,args);}
  finally {await client.auth.signOut({scope:'local'});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
