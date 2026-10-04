/* Shared workspace client. Permissions and authorship are enforced in PostgreSQL. */
(() => {
  'use strict';
  const BUCKET = 'application-documents', LIMIT = 50 * 1024 * 1024;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const slots = new Set(['cv','statement','portfolio','degree','transcript','language','aps','reference','employment']);
  const fields = new Set(['saved','stage','notes','folder','deadline','deadline_note','deadline_confirmed']);
  const record = value => value === 'library' || typeof value === 'string' && value.length <= 100 && /^[a-z0-9]+(-[a-z0-9]+)+$/.test(value);
  const abort = () => new DOMException('The operation was cancelled.', 'AbortError');
  function publicConfig(config) {
    if (!config || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url || '') || !uuid(config.workspaceId)) return false;
    const key = config.publishableKey || '';
    if (/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) return true;
    try { return key.split('.').length === 3 && JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role === 'anon'; } catch { return false; }
  }
  function empty() { return { version: 4, progress: Object.create(null), library: { folder: '', documents: Object.create(null), files: Object.create(null) } }; }
  function applyChanges(state, changes) {
    for (const item of changes) {
      const r = item.record_id, k = item.field;
      if (!record(r) || typeof k !== 'string') continue;
      if (r === 'library' && k === 'folder') { state.library.folder = item.value; continue; }
      if (r !== 'library' && fields.has(k)) {
        state.progress[r] ||= { documents: Object.create(null) };
        state.progress[r][k] = item.value; continue;
      }
      const parts = k.split('.');
      if (parts.length !== 3 || parts[0] !== 'documents' || !slots.has(parts[1]) || !['url','status','file_id'].includes(parts[2])) continue;
      if (r === 'library') {
        if (parts[2] === 'url') state.library.documents[parts[1]] = item.value;
        if (parts[2] === 'file_id') state.library.files[parts[1]] = item.value;
      } else {
        state.progress[r] ||= { documents: Object.create(null) };
        state.progress[r].documents ||= Object.create(null);
        state.progress[r].documents[parts[1]] ||= {};
        state.progress[r].documents[parts[1]][parts[2]] = item.value;
      }
    }
    return state;
  }
  function failure(error) {
    const result = new Error(error?.message || 'The workspace could not be reached. Check your connection and retry.');
    result.code = error?.code;
    result.accessDenied = error?.code === '42501' || [401,403].includes(Number(error?.status));
    return result;
  }
  const mimeTypes = {
    pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    odt:'application/vnd.oasis.opendocument.text',rtf:'application/rtf',txt:'text/plain',
    ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odp:'application/vnd.oasis.opendocument.presentation',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',zip:'application/zip'
  };
  class SupabaseWorkspace {
    static empty = empty;
    static applyChanges = applyChanges;
    static validConfig = publicConfig;
    static validId = uuid;
    static maxFileSize = LIMIT;
    constructor(onEvent = () => {}, config = window.ECOSAPIEN_SUPABASE) {
      this.config = config || {};
      this.configured = publicConfig(this.config);
      this.onEvent = onEvent;
      this.epoch = 0; this.connected = false; this.account = null; this.member = null;
      this.meta = null; this.files = new Map(); this.channel = null; this.live = false;
      this.loadSequence = 0; this.appliedSequence = 0;
      this.lifetime = new AbortController();
      if (!this.configured || !window.EcoCloudSDK) return;
      this.client = EcoCloudSDK.createClient(this.config.url, this.config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
        global: { fetch: (input, init = {}) => fetch(input, {
          ...init, cache: 'no-store',
          signal: init.signal ? AbortSignal.any([init.signal, this.lifetime.signal]) : this.lifetime.signal
        }) }
      });
      // Do not call Auth methods inside its callback; the SDK holds an Auth lock.
      this.client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' && this.account) {
          this.clear();
          queueMicrotask(() => this.onEvent({type:'expired'}));
        }
        if (event === 'PASSWORD_RECOVERY') {
          this.recovering = true;
          queueMicrotask(() => this.onEvent({type:'recovery'}));
        }
      });
    }
    get canEdit() { return this.connected && ['owner','editor'].includes(this.member?.role); }
    get canManage() { return this.connected && this.member?.role === 'owner'; }
    check(epoch) { if (epoch !== this.epoch) throw abort(); }
    async rpc(name, args = {}, signal) {
      if (!this.client) throw new Error('This website’s shared workspace is still being configured.');
      const epoch = this.epoch;
      let call = this.client.rpc(name, {p_workspace:this.config.workspaceId, ...args});
      if (signal) call = call.abortSignal(signal);
      const {data,error} = await call;
      this.check(epoch);
      if (signal?.aborted) throw abort();
      if (error) throw failure(error);
      return data;
    }
    async start() {
      if (!this.client) return null;
      const epoch = this.epoch, {data,error} = await this.client.auth.getSession();
      this.check(epoch);
      if (error) throw failure(error);
      return data.session ? this.open(data.session) : null;
    }
    async signIn(email, password) {
      const epoch = this.epoch;
      const {data,error} = await this.client.auth.signInWithPassword({email,password});
      if (epoch !== this.epoch && data?.session && !this.account) await this.client.auth.signOut({scope:'local'});
      this.check(epoch);
      if (error) throw failure(error);
      return this.open(data.session);
    }
    async register(email, password) {
      const epoch = this.epoch;
      const {data,error} = await this.client.auth.signUp({
        email,password,options:{emailRedirectTo:new URL('databases.html',location.href).href}
      });
      if (epoch !== this.epoch && data?.session && !this.account) await this.client.auth.signOut({scope:'local'});
      this.check(epoch);
      if (error) throw failure(error);
      if (data.session) return this.open(data.session);
      return null;
    }
    async resetPassword(email) {
      const {error} = await this.client.auth.resetPasswordForEmail(email, {redirectTo:new URL('databases.html',location.href).href});
      if (error) throw failure(error);
    }
    async updatePassword(password) {
      const {error} = await this.client.auth.updateUser({password});
      if (error) throw failure(error);
      this.recovering = false;
    }
    async open(session) {
      const epoch = this.epoch;
      if (!session?.user) throw new Error('Sign in to open the workspace.');
      if (this.account && this.account.id !== session.user.id) throw new Error('Sign out before using a different account.');
      this.account = {id:session.user.id,email:session.user.email || ''};
      await this.rpc('eco_join_workspace');
      this.check(epoch);
      const state = await this.load();
      this.check(epoch); this.connected = true;
      this.subscribe();
      return state;
    }
    async load() {
      const sequence = ++this.loadSequence;
      const data = await this.rpc('eco_snapshot');
      if (data?.version !== 4 || !Array.isArray(data.fields) || data.workspace?.id !== this.config.workspaceId || data.member?.user_id !== this.account?.id) {
        throw new Error('The server returned an unexpected workspace. Sign out and retry.');
      }
      // A slow refresh must not overwrite a later acknowledged save. Activity
      // IDs reflect committed writes; sequence breaks ties for pending uploads.
      const incoming = Number(data.activity[0]?.id || 0), current = Number(this.meta?.activity[0]?.id || 0);
      if (this.meta && (incoming < current || (incoming === current && sequence < this.appliedSequence))) {
        const state = applyChanges(empty(),this.meta.fields);
        state.workspace_id = this.meta.workspace.id;
        return state;
      }
      this.appliedSequence = sequence;
      this.meta = data; this.member = data.member;
      this.files = new Map(data.files.map(file => [file.id,file]));
      const state = applyChanges(empty(),data.fields);
      state.workspace_id = data.workspace.id;
      return state;
    }
    async save(batch) {
      if (!this.canEdit) throw new Error('Your account has read-only access.');
      batch.requestId ||= crypto.randomUUID();
      return this.rpc('eco_save',{p_request:batch.requestId,p_changes:batch.changes});
    }
    subscribe() {
      if (this.channel || !this.connected) return;
      const epoch = this.epoch;
      this.channel = this.client.channel('applications-' + this.config.workspaceId)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'eco_activity',filter:'workspace_id=eq.'+this.config.workspaceId}, () => {
          if (epoch === this.epoch) this.onEvent({type:'change'});
        }).subscribe(status => {
          if (epoch !== this.epoch) return;
          this.live = status === 'SUBSCRIBED';
          this.onEvent({type:'connection'});
        });
    }
    clear() {
      this.epoch++; this.lifetime.abort(); this.lifetime = new AbortController();
      if (this.channel) this.client.removeChannel(this.channel).catch(() => {});
      this.channel = null; this.live = false; this.connected = false; this.account = null;
      this.member = null; this.meta = null; this.files.clear(); this.recovering = false;
      this.loadSequence = 0; this.appliedSequence = 0;
    }
    async signOut() {
      this.clear();
      if (this.client) await this.client.auth.signOut({scope:'local'}).catch(() => {});
    }
    async upload(file, target, onProgress, signal) {
      if (!this.canEdit) throw new Error('Your account has read-only access.');
      if (!record(target.id) || !slots.has(target.key)) throw new Error('Choose an application and a document type.');
      const suffix = file.name.split('.').at(-1)?.toLowerCase(), mime = mimeTypes[suffix];
      if (!mime || /[\u0000-\u001f\u007f/\\]/.test(file.name) || file.name.length > 220) throw new Error('Choose a PDF, Office document, text, image or ZIP file with a short filename.');
      if (!file.size || file.size > LIMIT) throw new Error('Choose a non-empty file no larger than 50 MB.');
      const epoch = this.epoch, id = crypto.randomUUID();
      const combined = AbortSignal.any([signal,this.lifetime.signal].filter(Boolean));
      if (combined.aborted) throw abort();
      const intent = await this.rpc('eco_begin_upload',{
        p_file:id,p_record:target.id,p_slot:target.key,p_name:file.name,p_size:file.size,p_mime:mime
      },combined);
      this.check(epoch);
      // TUS resumes interrupted requests while this page remains open. Do not
      // persist filenames, upload URLs or credentials to localStorage.
      await new Promise((resolve,reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return; settled = true;
          combined.removeEventListener('abort', cancel);
          if (error) reject(error); else resolve();
        };
        const uploader = new EcoCloudSDK.Upload(file,{
          endpoint:this.config.url.replace(/\/$/,'').replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable',
          chunkSize:6*1024*1024, retryDelays:[0,1000,3000,5000,10000], uploadDataDuringCreation:true,
          storeFingerprintForResuming:false, removeFingerprintOnSuccess:true,
          metadata:{bucketName:BUCKET,objectName:intent.object_path,contentType:mime,cacheControl:'0'},
          onBeforeRequest:async request => {
            this.check(epoch);
            if (combined.aborted) throw abort();
            const {data,error} = await this.client.auth.getSession();
            this.check(epoch);
            if (error || !data.session || data.session.user.id !== this.account?.id) throw new Error('Sign in again to continue uploading.');
            request.setHeader('Authorization','Bearer '+data.session.access_token);
            request.setHeader('apikey',this.config.publishableKey);
            request.setHeader('x-upsert','false');
          },
          onProgress:(sent,total) => { if (epoch === this.epoch && !combined.aborted) onProgress(Math.round(sent/total*100)); },
          onSuccess:() => finish(),
          onError:() => finish(new Error('The upload could not finish. Check your connection and retry. If the file arrived, use “Finish linking” under unfinished uploads.'))
        });
        const cancel = () => { uploader.abort(false).catch(() => {}); finish(abort()); };
        combined.addEventListener('abort',cancel,{once:true});
        if (combined.aborted) cancel(); else uploader.start();
      });
      this.check(epoch);
      return this.rpc('eco_complete_upload',{p_file:id},combined);
    }
    async completeUpload(id) { return this.rpc('eco_complete_upload',{p_file:id}); }
    async download(id) {
      const epoch = this.epoch, file = this.files.get(id);
      if (!this.connected || !file) throw new Error('This file is not available in the current workspace. Sync and retry.');
      const {data,error} = await this.client.storage.from(BUCKET).download(file.object_path,{}, {signal:this.lifetime.signal,cache:'no-store'});
      this.check(epoch);
      if (error) throw failure(error);
      return {name:file.filename,blob:data};
    }
    async invite(email,name,role,kind) {
      return this.rpc('eco_invite_member',{p_email:email,p_name:name,p_role:role,p_kind:kind});
    }
    async revokeInvitation(email) { return this.rpc('eco_revoke_invitation',{p_email:email}); }
    async setMember(id,role) { return this.rpc('eco_set_member',{p_user:id,p_role:role}); }
  }
  window.SupabaseWorkspace = SupabaseWorkspace;
})();
