/* Synthetic SDK transport for UI tests. SQL permissions are tested separately
   against the real migrations in check_supabase_sql.mjs. No real accounts. */
(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  window.createSupabaseMock = function(seed) {
    const workspace = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const ids = {owner:'11111111-1111-4111-8111-111111111111',viewer:'22222222-2222-4222-8222-222222222222',agent:'33333333-3333-4333-8333-333333333333'};
    const mock = {
      config:{url:'https://exampleproject.supabase.co',publishableKey:'sb_publishable_synthetic',workspaceId:workspace},
      state:seed || {version:4,workspace:{id:workspace,name:'Synthetic shared workspace'},fields:[],files:[],pending_uploads:[],activity:[],members:[
        {workspace_id:workspace,user_id:ids.owner,role:'owner',actor_kind:'person',display_name:'Test owner'},
        {workspace_id:workspace,user_id:ids.viewer,role:'viewer',actor_kind:'person',display_name:'Test viewer'},
        {workspace_id:workspace,user_id:ids.agent,role:'editor',actor_kind:'agent',display_name:'Application agent'}
      ],invitations:[]},
      binaries:new Map(), requests:new Map(), calls:[], uploads:[], channels:[],
      session:null, role:'owner', revoked:false, failSave:null, holdUpload:false, holdSnapshot:false,
      id:0, authCallbacks:[], get member(){return this.state.members.find(m=>m.user_id===ids[this.role]);}
    };
    mock.setField = (record_id,field,value) => {
      const entry=mock.state.fields.find(f=>f.record_id===record_id&&f.field===field);
      if(entry)entry.value=value;else mock.state.fields.push({record_id,field,value,workspace_id:workspace});
    };
    mock.activity = (action,record_id,details={},file_id=null,member=mock.member) => {
      mock.state.activity.unshift({id:++mock.id,workspace_id:workspace,actor_id:member.user_id,actor_name:member.display_name,actor_kind:member.actor_kind,action,record_id,file_id,details,created_at:new Date().toISOString()});
      mock.channels.forEach(fn=>fn());
    };
    mock.id=Math.max(0,...mock.state.activity.map(a=>a.id));
    const denied = {data:null,error:{message:'You do not have permission for this workspace.',code:'42501'}};
    mock.run = async (name,args) => {
      mock.calls.push({name,args:clone(args)});
      if (mock.holdSnapshot&&name==='eco_snapshot') await new Promise(resolve=>{mock.releaseSnapshot=resolve;});
      if (mock.revoked || !mock.session) return clone(denied);
      if(name==='eco_join_workspace')return {data:clone(mock.member),error:null};
      if(name==='eco_snapshot') {
        const data=clone(mock.state);data.member=clone(mock.member);
        data.pending_uploads=data.pending_uploads.filter(f=>f.uploaded_by===mock.member.user_id);
        if(mock.role!=='owner')data.invitations=[];
        return {data,error:null};
      }
      if(mock.role==='viewer')return clone(denied);
      if(name==='eco_save') {
        if(mock.failSave==='before'){mock.failSave=null;return {data:null,error:{message:'Synthetic network failure before save.'}};}
        if(!mock.requests.has(args.p_request)) {
          const changes=args.p_changes.map(c=>{
            const before=mock.state.fields.find(f=>f.record_id===c.record_id&&f.field===c.field)?.value??null;
            mock.setField(c.record_id,c.field,c.value);return {...c,before,after:c.value};
          });
          mock.requests.set(args.p_request,true);mock.activity('progress_updated',changes[0]?.record_id,{changes});
        }
        if(mock.failSave==='after'){mock.failSave=null;return {data:null,error:{message:'Synthetic lost save response.'}};}
        return {data:{applied:args.p_changes.length},error:null};
      }
      if(name==='eco_begin_upload') {
        const file={id:args.p_file,workspace_id:workspace,record_id:args.p_record,slot:args.p_slot,filename:args.p_name,size_bytes:args.p_size,mime_type:args.p_mime,status:'pending',object_path:workspace+'/'+args.p_record+'/'+args.p_slot+'/'+args.p_file,uploaded_by:mock.member.user_id,actor_name:mock.member.display_name,actor_kind:mock.member.actor_kind,created_at:new Date().toISOString()};
        mock.state.pending_uploads.push(file);return {data:clone(file),error:null};
      }
      if(name==='eco_complete_upload') {
        const done=mock.state.files.find(f=>f.id===args.p_file);
        if(done)return {data:clone(done),error:null};
        const file=mock.state.pending_uploads.find(f=>f.id===args.p_file);
        if(!file||!mock.binaries.has(file.object_path))return {data:null,error:{message:'The file upload is not complete.'}};
        file.status='ready';file.completed_at=new Date().toISOString();
        mock.state.files.unshift(file);mock.state.pending_uploads=mock.state.pending_uploads.filter(f=>f.id!==file.id);
        mock.setField(file.record_id,'documents.'+file.slot+'.file_id',file.id);
        mock.setField(file.record_id,'documents.'+file.slot+'.url','');
        if(file.record_id!=='library') {
          mock.setField(file.record_id,'documents.'+file.slot+'.status','Ready');
          mock.setField(file.record_id,'saved',true);
          const stage=mock.state.fields.find(f=>f.record_id===file.record_id&&f.field==='stage')?.value;
          if(!stage||stage==='Not started')mock.setField(file.record_id,'stage','Preparing');
        }
        mock.activity('document_uploaded',file.record_id,{filename:file.filename,slot:file.slot},file.id);
        return {data:clone(file),error:null};
      }
      if(name==='eco_invite_member') {
        mock.state.invitations.push({email:args.p_email,display_name:args.p_name,role:args.p_role,actor_kind:args.p_kind,expires_at:new Date(Date.now()+30*86400000).toISOString()});
        mock.activity('member_invited',null);return {data:null,error:null};
      }
      if(name==='eco_revoke_invitation') {
        mock.state.invitations=mock.state.invitations.filter(i=>i.email!==args.p_email);return {data:null,error:null};
      }
      if(name==='eco_set_member') {
        if(args.p_role==='removed')mock.state.members=mock.state.members.filter(m=>m.user_id!==args.p_user);
        else mock.state.members.find(m=>m.user_id===args.p_user).role=args.p_role;
        return {data:null,error:null};
      }
      throw new Error('Unexpected synthetic RPC '+name);
    };
    mock.sdk = {
      createClient(url,key,options) {
        mock.options=options;
        return {
          auth:{
            onAuthStateChange(callback){mock.authCallbacks.push(callback);return {data:{subscription:{unsubscribe(){}}}};},
            async getSession(){return {data:{session:mock.session},error:null};},
            async signInWithPassword({email,password}) {
              if(mock.holdAuth)await new Promise(resolve=>{mock.releaseAuth=resolve;});
              if(password==='wrong')return {data:{},error:{message:'Invalid login credentials'}};
              mock.role=email.startsWith('viewer')?'viewer':email.startsWith('agent')?'agent':'owner';
              mock.session={user:{id:ids[mock.role],email},access_token:'synthetic-session-only'};
              return {data:{session:mock.session},error:null};
            },
            async signUp(){return {data:{session:null},error:null};},
            async resetPasswordForEmail(){return {error:null};},
            async updateUser(){return {error:null};},
            async signOut(){mock.session=null;mock.authCallbacks.forEach(fn=>fn('SIGNED_OUT',null));return {error:null};}
          },
          rpc(name,args){return {then:(resolve,reject)=>mock.run(name,args).then(resolve,reject),abortSignal(){return this;}};},
          from(table){
            const filters=[];let sort=null,maximum=Infinity,single=false;
            const query={
              select(){return this;},eq(key,value){filters.push(row=>row[key]===value);return this;},
              gt(key,value){filters.push(row=>Number(row[key])>Number(value));return this;},
              order(key,{ascending}){sort={key,ascending};return this;},
              limit(value){maximum=value;return this;},single(){single=true;return this;},
              then(resolve,reject){
                if(mock.revoked||!mock.session)return Promise.resolve(clone(denied)).then(resolve,reject);
                let rows=clone(table==='eco_files'?mock.state.files:table==='eco_activity'?mock.state.activity:[]);
                rows=rows.filter(row=>filters.every(filter=>filter(row)));
                if(sort)rows.sort((a,b)=>(sort.ascending?1:-1)*(Number(a[sort.key])-Number(b[sort.key])));
                rows=rows.slice(0,maximum);
                return Promise.resolve({data:single?rows[0]:rows,error:single&&!rows.length?{message:'Not found'}:null}).then(resolve,reject);
              }
            };
            return query;
          },
          channel(){return {on(type,filter,callback){mock.channels.push(callback);return this;},subscribe(callback){setTimeout(()=>callback('SUBSCRIBED'),0);return this;}};},
          async removeChannel(){mock.channels=[];},
          storage:{from(){return {async download(path){
            if(mock.revoked||!mock.session)return clone(denied);
            const blob=mock.binaries.get(path);
            return blob?{data:blob,error:null}:{data:null,error:{message:'Synthetic file not found'}};
          }}}}
        };
      },
      Upload:class {
        constructor(file,options){this.file=file;this.options=options;this.cancelled=false;mock.uploads.push(this);}
        async start(){
          try{
            this.headers={};await this.options.onBeforeRequest({setHeader:(key,value)=>{this.headers[key]=value;}});
            if(this.cancelled)return;
            this.options.onProgress?.(Math.round(this.file.size/2),this.file.size);
            if(mock.holdUpload)return;
            this.finish();
          }catch{if(!this.cancelled)this.options.onError();}
        }
        finish(){if(this.cancelled)return;mock.binaries.set(this.options.metadata.objectName,this.file);this.options.onProgress?.(this.file.size,this.file.size);this.options.onSuccess();}
        async abort(){this.cancelled=true;}
      }
    };
    return mock;
  };
})();
