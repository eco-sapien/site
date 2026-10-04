/* Email accounts, field-level autosave and the shared workspace activity UI. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), LEGACY = 'ecosapien-all-applications-v1';
  const copy = value => JSON.parse(JSON.stringify(value));
  const date = value => new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(value));
  class ApplicationAccount {
    constructor(options) {
      this.options = options; this.epoch = 0; this.hasData = false;
      this.pending = new Map(); this.failedBatch = null; this.saving = null; this.uploading = null;
      this.authenticating = false; this.syncing = false; this.managing = false; this.mode = 'login';
      this.observed = this.flatten(options.snapshot());
      this.workspace = new SupabaseWorkspace(event => {
        if (event.type === 'expired') this.signOut('Your session ended. Sign in again to load the shared workspace.');
        if (event.type === 'recovery') { this.mode = 'password'; this.login(); }
        if (event.type === 'change') {
          clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => this.sync(false),500);
        }
        if (event.type === 'connection') this.render();
      });
      document.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', () => this.login()));
      $('close-login').addEventListener('click', () => $('login-dialog').close());
      $('login-dialog').addEventListener('close', () => { $('login-password').value = ''; });
      $('login-form').addEventListener('submit', event => { event.preventDefault(); this.authenticate(); });
      $('login-new-account').addEventListener('click', () => this.authMode('register'));
      $('login-reset').addEventListener('click', () => this.authMode('reset'));
      $('login-back').addEventListener('click', () => this.authMode('login'));
      $('account-signout').addEventListener('click', () => {
        if ((this.dirty || this.uploading) && !confirm('There are unsaved changes or an upload in progress. Sign out and discard unfinished work? Saved documents will remain in the workspace.')) return;
        this.signOut();
      });
      $('sync-workspace').addEventListener('click', () => this.sync(true));
      $('retry-save').addEventListener('click', () => { if (this.require()) this.flush(); });
      $('cancel-upload').addEventListener('click', () => this.uploading?.controller.abort());
      $('import-browser').addEventListener('click', () => this.importBrowser());
      $('clear-browser').addEventListener('click', () => {
        if (!confirm('Remove the old progress saved in this browser? Saved cloud data will remain.')) return;
        try { localStorage.removeItem(LEGACY); this.legacy(); } catch { this.status('Browser storage could not be cleared. Use your browser’s site-data settings.'); }
      });
      $('invite-form').addEventListener('submit', event => {
        event.preventDefault();
        this.admin(async () => {
          await this.workspace.invite($('invite-email').value.trim(),$('invite-name').value.trim(),$('invite-role').value,$('invite-kind').value);
          $('invite-form').reset();
          $('member-message').textContent = 'Access reserved for this verified email. Share the Databases page address with them. No invitation email was sent.';
        });
      });
      window.addEventListener('beforeunload', event => { if (this.dirty || this.uploading) { event.preventDefault(); event.returnValue = ''; } });
      window.addEventListener('pageshow', event => { if (event.persisted) this.signOut(); });
      window.addEventListener('storage', event => { if (event.key === LEGACY) this.legacy(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.sync(false); });
      this.poll = setInterval(() => { if (document.visibilityState === 'visible') this.sync(false); },30000);
      $('account-bar').hidden = false; this.legacy();
      queueMicrotask(async () => {
        try {
          const state = await this.workspace.start();
          if (state) this.accept(state);
        } catch (error) { if (error.name !== 'AbortError') this.signOut(error.message); }
        this.render();
      });
    }
    get dirty() { return !!this.pending.size || !!this.failedBatch || !!this.saving; }
    status(message) { $('save-status').textContent = message; }
    flatten(state) {
      const values = new Map(), set = (record_id,field,value) => values.set(record_id+'|'+field,{record_id,field,value});
      for (const record of this.options.records) {
        const p = state.progress[record.id] || {};
        for (const [key,fallback] of Object.entries({saved:false,stage:'Not started',notes:'',folder:'',deadline:'',deadline_note:'',deadline_confirmed:false})) set(record.id,key,p[key] ?? fallback);
        for (const [key] of this.options.documentTypes) {
          const doc = p.documents?.[key] || {};
          set(record.id,'documents.'+key+'.status',doc.status || 'Needed');
          set(record.id,'documents.'+key+'.url',doc.url || '');
          set(record.id,'documents.'+key+'.file_id',doc.file_id || '');
        }
      }
      set('library','folder',state.library.folder || '');
      for (const [key] of this.options.documentTypes) {
        set('library','documents.'+key+'.url',state.library.documents[key] || '');
        set('library','documents.'+key+'.file_id',state.library.files?.[key] || '');
      }
      return values;
    }
    apply(state) {
      const merged = copy(state);
      if (this.failedBatch) SupabaseWorkspace.applyChanges(merged,this.failedBatch.changes);
      SupabaseWorkspace.applyChanges(merged,[...this.pending.values()]);
      this.options.apply(merged); this.observed = this.flatten(this.options.snapshot());
      this.renderShared();
    }
    changed() {
      if (!this.hasData || !this.workspace.canEdit) return;
      const next = this.flatten(this.options.snapshot());
      next.forEach((change,key) => { if (this.observed.get(key)?.value !== change.value) this.pending.set(key,change); });
      this.observed = next;
      if (!this.pending.size) return;
      this.status('Saving your changes to the shared workspace…');
      clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(),1400);
    }
    require(write = true) {
      if (!this.hasData || !this.workspace.connected) { this.login(); return false; }
      if (write && !this.workspace.canEdit) { this.status('You have viewer access. You can read progress and download documents.'); return false; }
      return true;
    }
    render() {
      const user = this.workspace.account, connected = this.hasData && this.workspace.connected, editable = connected && this.workspace.canEdit;
      $('account-title').textContent = connected ? this.workspace.meta.workspace.name : 'Your private application workspace';
      $('account-detail').textContent = connected
        ? this.workspace.member.display_name+' · '+this.workspace.member.role+' · '+user.email
        : this.workspace.configured ? 'Sign in with your invited email to share progress and documents.' : 'The shared workspace is being set up. The programme index remains available below.';
      $('account-bar').dataset.connected = String(connected);
      $('account-login').hidden = connected; $('account-login').textContent = 'Sign in';
      $('account-signout').hidden = !user && !this.authenticating;
      $('sync-workspace').hidden = !this.hasData; $('sync-workspace').disabled = !!this.saving || !!this.uploading || this.syncing;
      $('backup-progress').hidden = !this.hasData; $('restore-progress').hidden = !editable;
      $('export-csv').textContent = this.hasData ? 'Export filtered CSV + notes' : 'Export filtered CSV';
      $('retry-save').hidden = !this.failedBatch && !this.pending.size;
      $('import-browser').hidden = !editable;
      $('import-browser').textContent = 'Move browser progress into this shared workspace';
      $('workspace-updates').hidden = !this.hasData;
      $('members-panel').hidden = !this.hasData;
      $('invite-controls').hidden = !this.workspace.canManage;
      $('invite-controls').disabled = this.managing || !this.workspace.canManage;
      $('live-status').textContent = this.hasData ? this.workspace.live ? 'Live updates connected' : 'Updates refresh every 30 seconds while this page is open' : '';
      this.options.access(this.hasData,connected,editable);
    }
    legacy() {
      let found = false;
      try { found = !!localStorage.getItem(LEGACY); } catch { /* No legacy storage. */ }
      $('legacy-notice').hidden = !found;
    }
    authMode(mode) { this.mode = mode; $('login-message').textContent = ''; $('login-password').value = ''; this.renderAuth(); }
    login() {
      if (!$('login-dialog').open) $('login-dialog').showModal();
      this.renderAuth();
    }
    renderAuth() {
      const configured = this.workspace.configured && !!this.workspace.client, passwordMode = this.mode === 'password';
      $('login-title').textContent = {login:'Welcome to your workspace.',register:'Create your website account.',reset:'Reset your password.',password:'Choose a new password.'}[this.mode];
      $('login-intro').textContent = {login:'Use your invited email and website password. Everyone in the workspace shares the same progress and documents.',register:'Register with the email invited by your workspace owner. Confirm that email before signing in. Registration alone does not grant workspace access.',reset:'Enter your website account email to request a password reset link.',password:'Save a new password for your website account.'}[this.mode];
      $('login-email-label').hidden = passwordMode; $('login-email').required = !passwordMode;
      $('login-password-label').hidden = this.mode === 'reset'; $('login-password').required = this.mode !== 'reset';
      $('login-password').minLength = ['register','password'].includes(this.mode) ? 12 : 1;
      $('login-password').autocomplete = ['register','password'].includes(this.mode) ? 'new-password' : 'current-password';
      $('login-submit').textContent = this.authenticating ? 'Please wait…' : {login:'Sign in',register:'Create account',reset:'Send reset link',password:'Save new password'}[this.mode];
      $('login-submit').disabled = !configured || this.authenticating;
      $('login-fields').disabled = !configured || this.authenticating;
      $('login-new-account').hidden = this.mode !== 'login'; $('login-reset').hidden = this.mode !== 'login';
      $('login-back').hidden = this.mode === 'login' || passwordMode;
      $('login-setup-note').hidden = configured;
    }
    async authenticate() {
      if (this.authenticating || !this.workspace.configured || !this.workspace.client) return;
      const epoch = this.epoch, mode = this.mode, email = $('login-email').value.trim(), password = $('login-password').value;
      this.authenticating = true; this.renderAuth(); this.render();
      try {
        if (mode === 'reset') {
          await this.workspace.resetPassword(email);
          if (epoch !== this.epoch) return;
          $('login-message').textContent = 'If this account can receive email, a reset link has been requested. Open it in this browser. If it does not arrive, contact the workspace owner.';
        } else if (mode === 'password') {
          await this.workspace.updatePassword(password);
          if (epoch !== this.epoch) return;
          $('login-message').textContent = 'Password updated. You can continue with your workspace.';
          this.mode = 'login';
          if (this.hasData) $('login-dialog').close();
        } else {
          const state = mode === 'register' ? await this.workspace.register(email,password) : await this.workspace.signIn(email,password);
          if (epoch !== this.epoch) return;
          if (state) this.accept(state);
          else {
            this.mode = 'login';
            $('login-message').textContent = 'Confirm the email sent for your new account, then sign in. If no email arrives, contact the workspace owner.';
          }
        }
      } catch (error) {
        if (epoch !== this.epoch || error.name === 'AbortError') return;
        if (!this.hasData && this.workspace.account) await this.workspace.signOut();
        $('login-message').textContent = error.message || 'Sign-in could not finish. Please retry.';
      } finally {
        if (epoch === this.epoch) {
          this.authenticating = false; $('login-password').value = '';
          this.renderAuth(); this.render();
        }
      }
    }
    accept(state) {
      this.hasData = true; this.apply(state); this.render();
      if (!this.workspace.recovering) { $('login-dialog').close(); this.mode = 'login'; }
      this.status('Shared workspace ready. Changes save automatically; uploads remain private to its members.');
    }
    denied(error) {
      if (!error.accessDenied) return false;
      this.signOut('Your workspace access needs to be checked. Sign in again, or ask the owner to restore access.');
      return true;
    }
    async flush() {
      clearTimeout(this.timer);
      if (this.saving) return this.saving;
      if (!this.hasData || !this.workspace.canEdit) return false;
      const epoch = this.epoch;
      this.saving = Promise.resolve().then(async () => {
        try {
          while (this.pending.size || this.failedBatch) {
            const batch = this.failedBatch || {changes:[...this.pending.values()]};
            if (!this.failedBatch) this.pending.clear();
            this.failedBatch = batch;
            this.status('Saving to the shared workspace…');
            await this.workspace.save(batch);
            const state = await this.workspace.load();
            if (epoch !== this.epoch) return false;
            this.failedBatch = null; this.apply(state);
          }
          this.status('All changes saved to the shared workspace.');
          return true;
        } catch (error) {
          if (epoch === this.epoch && error.name !== 'AbortError' && !this.denied(error)) this.status('Save not yet confirmed. '+error.message+' Retry, or download a progress backup before closing this page.');
          return false;
        } finally { if (epoch === this.epoch) { this.saving = null; this.render(); } }
      });
      this.render(); return this.saving;
    }
    async sync(manual = true) {
      if (!this.hasData || !this.workspace.connected || this.syncing || this.saving || this.uploading) return;
      const epoch = this.epoch;
      if (manual && this.dirty && !await this.flush()) return;
      this.syncing = true; this.render();
      try {
        const state = await this.workspace.load();
        if (epoch !== this.epoch) return;
        this.apply(state);
        if (manual) this.status('Up to date with the shared workspace.');
      } catch (error) { if (epoch === this.epoch && error.name !== 'AbortError' && !this.denied(error)) this.status('Updates could not be refreshed. '+error.message); }
      finally { if (epoch === this.epoch) { this.syncing = false; this.render(); } }
    }
    signOut(message = 'Signed out. Saved progress and documents remain in the private workspace.') {
      this.epoch++; clearTimeout(this.timer); clearTimeout(this.refreshTimer);
      this.uploading?.controller.abort();
      this.workspace.signOut();
      this.pending.clear(); this.failedBatch = null; this.saving = null; this.uploading = null;
      this.hasData = false; this.authenticating = false; this.syncing = false; this.managing = false; this.mode = 'login';
      this.options.apply(SupabaseWorkspace.empty()); this.observed = this.flatten(this.options.snapshot());
      $('upload-notice').hidden = true; $('upload-message').textContent = '';
      $('backup-file').value = ''; $('document-file').value = '';
      $('login-dialog').close(); $('login-form').reset(); $('login-message').textContent = '';
      $('invite-form').reset(); $('member-message').textContent = '';
      for (const id of ['activity-list','member-list','invitation-list','pending-uploads']) $(id).replaceChildren();
      document.querySelectorAll('.personal-progress,[data-documents]').forEach(details => { details.open = false; });
      this.render(); this.status(message);
    }
    async upload(file,target) {
      if (!this.require() || this.uploading) return;
      if (this.dirty && !await this.flush()) return;
      const epoch = this.epoch, controller = new AbortController();
      this.uploading = {controller}; this.render();
      $('upload-notice').hidden = false; $('cancel-upload').hidden = false;
      $('upload-progress').hidden = false; $('upload-progress').value = 0;
      $('upload-message').textContent = 'Uploading '+file.name+' to this application’s private documents…';
      try {
        const result = await this.workspace.upload(file,target,value => {
          if (epoch === this.epoch) $('upload-progress').value = value;
        },controller.signal);
        const state = await this.workspace.load();
        if (epoch !== this.epoch) return;
        this.apply(state);
        $('upload-message').textContent = result.filename+' uploaded and attached. Earlier versions are retained. This does not submit a university application.';
      } catch (error) {
        if (epoch === this.epoch && !this.denied(error)) $('upload-message').textContent = error.name === 'AbortError'
          ? 'Upload cancelled. If the file had already arrived, it can be attached under unfinished uploads.'
          : error.message || 'Upload failed. Check your connection and retry.';
      } finally {
        if (epoch === this.epoch) {
          this.uploading = null; $('cancel-upload').hidden = true; $('upload-progress').hidden = true;
          this.render(); this.sync(false);
        }
      }
    }
    async admin(action) {
      if (!this.require() || !this.workspace.canManage || this.managing) return;
      const epoch = this.epoch; this.managing = true; this.render();
      try {
        await action();
        const state = await this.workspace.load();
        if (epoch === this.epoch) this.apply(state);
      } catch (error) { if (epoch === this.epoch && !this.denied(error)) $('member-message').textContent = error.message; }
      finally { if (epoch === this.epoch) { this.managing = false; this.render(); this.renderShared(); } }
    }
    renderShared() {
      const meta = this.hasData ? this.workspace.meta : null;
      if (!meta) return;
      const labelFor = id => id === 'library' ? 'Shared resources' : this.options.records.find(r=>r.id===id)?.programme || 'Workspace';
      const fieldLabel = field => {
        const labels = {saved:'Tracked',stage:'Application stage',notes:'Notes',folder:'Existing Drive folder',deadline:'Deadline',deadline_note:'Deadline source / time',deadline_confirmed:'Deadline confirmed'};
        if (labels[field]) return labels[field];
        const parts = field.split('.'), slot = this.options.documentTypes.find(type=>type[0]===parts[1]);
        return slot ? slot[1]+' '+({status:'status',url:'Drive reference',file_id:'file'}[parts[2]] || '') : 'Application detail';
      };
      const fieldValue = (field,value) => {
        if (value == null || value === '') return 'None';
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        if (field.endsWith('.file_id')) return this.workspace.files.get(value)?.filename || 'Earlier document';
        return String(value);
      };
      const addText = (parent,tag,text,className) => {
        const node = document.createElement(tag); node.textContent = text;
        if (className) node.className = className; parent.append(node); return node;
      };
      $('activity-list').replaceChildren();
      for (const item of meta.activity) {
        const row = document.createElement('li');
        const action = {document_uploaded:'uploaded '+(item.details.filename || 'a document'),progress_updated:'updated application progress',member_joined:'joined the workspace',member_invited:'granted a new invitation',invitation_revoked:'removed an invitation',member_access_changed:'changed member access'}[item.action] || 'updated the workspace';
        addText(row,'p',item.actor_name+(item.actor_kind==='agent'?' · Agent':'')+' '+action);
        addText(row,'small',(item.record_id?labelFor(item.record_id)+' · ':'')+date(item.created_at));
        if (item.details.changes?.length) {
          const details = document.createElement('details'); addText(details,'summary','View '+item.details.changes.length+' changes');
          const list = document.createElement('ul');
          for (const change of item.details.changes) {
            const name = labelFor(change.record_id)+' · '+fieldLabel(change.field);
            addText(list,'li',name+': '+fieldValue(change.field,change.before)+' → '+fieldValue(change.field,change.after));
          }
          details.append(list); row.append(details);
        }
        $('activity-list').append(row);
      }
      if (!meta.activity.length) addText($('activity-list'),'li','No updates yet. Track an application or upload a document to begin.');
      $('member-list').replaceChildren();
      for (const member of meta.members) {
        const row = document.createElement('li');
        addText(row,'span',member.display_name+(member.actor_kind==='agent'?' · Agent':'')+(member.user_id===meta.member.user_id?' · You':''));
        if (!this.workspace.canManage || member.role === 'owner') addText(row,'small',member.role);
        else {
          const select = document.createElement('select'); select.setAttribute('aria-label','Access for '+member.display_name);
          for (const [value,text] of [['editor','Editor'],['viewer','Viewer'],['removed','Remove access']]) {
            const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
          }
          select.value = member.role; select.disabled = this.managing;
          select.addEventListener('change', () => {
            const role = select.value;
            if (role === 'removed' && !confirm('Remove '+member.display_name+' from this workspace? They will lose access to its progress and documents.')) { select.value = member.role; return; }
            this.admin(() => this.workspace.setMember(member.user_id,role));
          });
          row.append(select);
        }
        $('member-list').append(row);
      }
      $('invitation-list').replaceChildren();
      for (const invite of meta.invitations) {
        const row = document.createElement('li');
        addText(row,'span',invite.display_name+' · '+invite.email+' · '+invite.role);
        addText(row,'small','Expires '+date(invite.expires_at));
        const button = addText(row,'button','Remove invitation','text-button'); button.type = 'button'; button.disabled = this.managing;
        button.addEventListener('click', () => this.admin(() => this.workspace.revokeInvitation(invite.email)));
        $('invitation-list').append(row);
      }
      $('invitations-heading').hidden = !meta.invitations.length;
      $('pending-uploads').replaceChildren(); $('pending-panel').hidden = !meta.pending_uploads.length;
      for (const file of meta.pending_uploads) {
        const row = document.createElement('li');
        addText(row,'span',file.filename+' · '+labelFor(file.record_id));
        const button = addText(row,'button','Finish linking','button'); button.type = 'button'; button.disabled = !this.workspace.canEdit || !!this.uploading;
        button.addEventListener('click',async () => {
          if (!this.require()) return;
          const epoch = this.epoch; button.disabled = true;
          try {
            await this.workspace.completeUpload(file.id);
            const state = await this.workspace.load();
            if (epoch === this.epoch) { this.apply(state); this.render(); this.status('Document attached to its application.'); }
          } catch (error) { if (epoch === this.epoch && !this.denied(error)) this.status(error.message+' If the upload was interrupted, select the original file and upload again.'); }
          finally { if (epoch === this.epoch) button.disabled = false; }
        });
        $('pending-uploads').append(row);
      }
    }
    async importBrowser() {
      if (!this.require() || this.saving || this.uploading) return;
      const epoch = this.epoch;
      try {
        const raw = localStorage.getItem(LEGACY);
        if (!raw) { this.legacy(); return; }
        if (!confirm('Move the old browser progress into this shared workspace? All members can see it. Matching entries will use the browser copy; other entries remain.')) return;
        this.options.restore(JSON.parse(raw)); this.changed();
        if (await this.flush() && epoch === this.epoch) {
          if (localStorage.getItem(LEGACY) === raw) localStorage.removeItem(LEGACY);
          this.legacy(); this.status('Browser progress saved to the shared workspace. Its migrated browser copy was removed.');
        }
      } catch (error) { if (epoch === this.epoch) this.status(error.message || 'The browser copy could not be moved. It has been kept.'); }
    }
  }
  window.ApplicationAccount = ApplicationAccount;
})();
