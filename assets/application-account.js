/* Account UI and autosave queue for the separate Databases workspace. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const LEGACY = 'ecosapien-all-applications-v1';
  const CONFIG = 'ecosapien-google-client-id';
  const validClient = value => /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
  const copy = value => JSON.parse(JSON.stringify(value));

  class ApplicationAccount {
    constructor(options) {
      this.options = options;
      this.workspace = new DriveWorkspace(event => {
        if (event.type === 'expired') {
          this.status('Your Google connection expired. Reconnect to continue; unsaved work stays here until you close or sign out.');
          this.render();
        }
      });
      this.epoch = 0;
      this.hasData = false;
      this.pending = new Map();
      this.failedBatch = null;
      this.saving = null;
      this.uploading = null;
      this.authenticating = false;
      this.timer = null;
      this.observed = this.flatten(options.snapshot());
      this.offline = document.body.dataset.offline === 'true' || location.protocol === 'file:';
      this.clientId = window.ECOSAPIEN_GOOGLE?.clientId || '';
      try { this.clientId = this.clientId || localStorage.getItem(CONFIG) || ''; } catch { /* Public configuration can stay in memory. */ }
      $('google-client-id').value = this.clientId;
      document.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', () => this.login()));
      $('close-login').addEventListener('click', () => $('login-dialog').close());
      $('google-config-form').addEventListener('submit', event => {
        event.preventDefault();
        const value = $('google-client-id').value.trim();
        if (!validClient(value)) {
          $('login-message').textContent = 'Paste the public Web application ID ending in .apps.googleusercontent.com.';
          return;
        }
        if (this.hasData || this.authenticating) {
          $('login-message').textContent = 'Sign out before changing the website connection.';
          return;
        }
        this.clientId = value;
        try { localStorage.setItem(CONFIG, value); } catch { /* Usable for this visit. */ }
        $('google-setup').open = false;
        this.prepareGoogle();
      });
      $('google-connect').addEventListener('click', () => this.connect());
      $('account-signout').addEventListener('click', () => {
        if ((this.dirty || this.uploading) && !confirm('There are unsaved changes or an upload in progress. Sign out and discard unfinished work? Saved Drive files will remain.')) return;
        this.signOut();
      });
      $('sync-drive').addEventListener('click', () => this.sync());
      $('retry-save').addEventListener('click', () => { if (this.require()) this.flush(); });
      $('cancel-upload').addEventListener('click', () => this.uploading?.controller.abort());
      $('import-browser').addEventListener('click', () => this.importBrowser());
      $('clear-browser').addEventListener('click', () => {
        if (!confirm('Remove the old progress saved in this browser? This does not remove anything in Google Drive.')) return;
        try { localStorage.removeItem(LEGACY); this.legacy(); } catch { this.status('Browser storage could not be cleared. Clear this site’s data in your browser settings.'); }
      });
      window.addEventListener('beforeunload', event => { if (this.dirty || this.uploading) { event.preventDefault(); event.returnValue = ''; } });
      window.addEventListener('pageshow', event => { if (event.persisted) this.signOut(); });
      window.addEventListener('storage', event => { if (event.key === LEGACY) this.legacy(); });
      $('account-bar').hidden = false;
      this.render();
      this.legacy();
    }
    get dirty() { return !!this.pending.size || !!this.failedBatch || !!this.saving; }
    status(text) { $('save-status').textContent = text; }
    flatten(state) {
      const values = new Map();
      const set = (path, value) => values.set(JSON.stringify(path), { path, value });
      for (const record of this.options.records) {
        const p = state.progress[record.id] || {};
        for (const [key, fallback] of Object.entries({ saved: false, stage: 'Not started', notes: '', folder: '', deadline: '', deadline_note: '', deadline_confirmed: false })) set(['progress', record.id, key], p[key] ?? fallback);
        for (const [key] of this.options.documentTypes) {
          const doc = p.documents?.[key] || {};
          set(['progress', record.id, 'documents', key, 'status'], doc.status || 'Needed');
          set(['progress', record.id, 'documents', key, 'url'], doc.url || '');
        }
      }
      set(['library', 'folder'], state.library.folder || '');
      for (const [key] of this.options.documentTypes) set(['library', 'documents', key], state.library.documents[key] || '');
      return values;
    }
    apply(state) {
      const merged = copy(state);
      if (this.failedBatch) DriveWorkspace.applyChanges(merged, this.failedBatch.changes);
      DriveWorkspace.applyChanges(merged, [...this.pending.values()]);
      this.options.apply(merged);
      this.observed = this.flatten(this.options.snapshot());
    }
    changed() {
      if (!this.hasData) return;
      const next = this.flatten(this.options.snapshot());
      next.forEach((change, key) => { if (this.observed.get(key)?.value !== change.value) this.pending.set(key, change); });
      this.observed = next;
      if (!this.pending.size) return;
      this.status('Changes waiting to save to your Google Drive…');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 1400);
    }
    require() {
      if (this.hasData && this.workspace.connected) return true;
      this.login();
      return false;
    }
    render() {
      const user = this.workspace.account, connected = this.hasData && this.workspace.connected;
      $('account-title').textContent = user ? user.emailAddress || user.displayName : 'Your private application workspace';
      $('account-detail').textContent = this.offline ? 'Open the live website to sign in and upload files.'
        : this.hasData ? connected ? 'Connected to your Google Drive · files and progress stay in your account.' : 'Reconnect to Google to continue saving and uploading.'
        : 'Sign in to upload documents and save progress in your Google Drive.';
      $('account-bar').dataset.connected = String(connected);
      $('account-login').hidden = connected;
      $('account-login').textContent = this.offline ? 'Open private workspace' : user ? 'Reconnect to Google' : 'Sign in with Google';
      $('account-signout').hidden = !user && !this.authenticating;
      $('sync-drive').hidden = !this.hasData;
      $('sync-drive').disabled = !!this.saving || !!this.uploading || this.authenticating;
      $('backup-progress').hidden = !this.hasData;
      $('restore-progress').hidden = !this.hasData;
      $('export-csv').textContent = this.hasData ? 'Export filtered CSV + notes' : 'Export filtered CSV';
      $('retry-save').hidden = !this.failedBatch && !this.pending.size;
      $('import-browser').hidden = !connected;
      if (user) $('import-browser').textContent = 'Move browser progress to ' + (user.emailAddress || 'this account');
      this.options.access(this.hasData, connected);
    }
    legacy() {
      let found = false;
      try { found = !!localStorage.getItem(LEGACY); } catch { /* No legacy storage available. */ }
      $('legacy-notice').hidden = !found || this.offline;
    }
    login() {
      if (this.offline) { window.open('https://www.ecosapien.de/databases.html#login', '_blank', 'noopener,noreferrer'); return; }
      if (!$('login-dialog').open) $('login-dialog').showModal();
      $('google-setup').open = !validClient(this.clientId);
      this.prepareGoogle();
    }
    async prepareGoogle() {
      $('google-connect').disabled = true;
      if (!validClient(this.clientId)) {
        $('login-message').textContent = 'Google login needs a one-time website connection. Open the setup guide below to get the public client ID.';
        return;
      }
      if (this.authenticating) return;
      $('login-message').textContent = 'Loading Google sign-in…';
      try {
        if (!window.google?.accounts?.oauth2) {
          if (!this.googleLibrary) this.googleLibrary = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
            const timer = setTimeout(() => reject(new Error('Google sign-in did not load. Check your connection or browser content blocker, then reopen this window.')), 15000);
            script.onload = () => { clearTimeout(timer); resolve(); };
            script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Google sign-in could not load. Check your connection and retry.')); };
            document.head.append(script);
          }).catch(error => { this.googleLibrary = null; throw error; });
          await this.googleLibrary;
        }
        if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in is unavailable. Reload the page and retry.');
        $('google-connect').disabled = false;
        $('login-message').textContent = 'Choose the Google account where you want your applications stored.';
      } catch (error) { $('login-message').textContent = error.message; }
    }
    connect() {
      if (this.authenticating || !validClient(this.clientId) || !window.google?.accounts?.oauth2) return;
      const epoch = this.epoch;
      this.authenticating = true;
      $('google-connect').disabled = true;
      $('login-message').textContent = 'Complete sign-in in the Google window…';
      this.render();
      const fail = message => {
        if (epoch !== this.epoch) return;
        this.authenticating = false;
        $('login-message').textContent = message;
        $('google-connect').disabled = false;
        this.render();
      };
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: this.clientId, scope: DriveWorkspace.scope, include_granted_scopes: false,
          callback: async response => {
            if (epoch !== this.epoch) return;
            if (response.error || !response.access_token || !google.accounts.oauth2.hasGrantedAllScopes(response, DriveWorkspace.scope)) {
              fail('Google file access was not approved. Try again and allow this workspace to manage its own Drive files.');
              return;
            }
            $('login-message').textContent = 'Opening your private Drive workspace…';
            try {
              const state = await this.workspace.connect(response);
              if (epoch !== this.epoch) return;
              this.hasData = true;
              this.apply(state);
              this.authenticating = false;
              this.render(); this.legacy();
              $('login-dialog').close();
              this.status(this.pending.size || this.failedBatch ? 'Reconnected. Saving pending changes…' : 'Your private workspace is ready. Changes save automatically to Google Drive.');
              if (this.pending.size || this.failedBatch) this.flush();
            } catch (error) { if (error.name !== 'AbortError') fail(error.message || 'Google Drive could not be opened. Retry.'); }
          },
          error_callback: error => fail(error.type === 'popup_closed' ? 'The Google window was closed. You can try again.' : 'Google’s sign-in window could not open. Allow pop-ups for this site and retry.')
        });
        client.requestAccessToken({ prompt: this.workspace.account ? '' : 'select_account', ...(this.workspace.account?.emailAddress ? { hint: this.workspace.account.emailAddress } : {}) });
      } catch { fail('Google sign-in could not start. Check the public client ID and its authorised website address.'); }
    }
    async flush() {
      clearTimeout(this.timer);
      if (this.saving) return this.saving;
      if (!this.hasData || !this.workspace.connected) { this.render(); return false; }
      const epoch = this.epoch;
      const run = async () => {
        try {
          while (this.pending.size || this.failedBatch) {
            const batch = this.failedBatch || { changes: [...this.pending.values()] };
            if (!this.failedBatch) this.pending.clear();
            this.failedBatch = batch;
            this.status('Saving your progress to Google Drive…');
            await this.workspace.save(batch);
            const state = await this.workspace.load();
            if (epoch !== this.epoch) return false;
            this.failedBatch = null;
            this.apply(state);
          }
          this.status('All changes saved to your Google Drive.');
          return true;
        } catch (error) {
          if (epoch === this.epoch && error.name !== 'AbortError') this.status('Progress has not been confirmed saved. ' + (error.message || 'Check your connection, then retry.') + ' You can also download a backup.');
          return false;
        } finally { if (epoch === this.epoch) { this.saving = null; this.render(); } }
      };
      // Defer execution so the finally block always follows assignment.
      this.saving = Promise.resolve().then(run);
      this.render();
      return this.saving;
    }
    async sync() {
      if (!this.require() || this.saving || this.uploading) return;
      const epoch = this.epoch;
      if (this.dirty && !await this.flush()) return;
      try {
        this.status('Loading the latest progress from Google Drive…');
        const state = await this.workspace.load();
        if (epoch !== this.epoch) return;
        this.apply(state); this.status('Up to date with your Google Drive.');
      } catch (error) { if (epoch === this.epoch) this.status(error.message || 'Could not refresh. Your current work has been kept.'); }
    }
    signOut() {
      this.epoch++;
      clearTimeout(this.timer);
      this.uploading?.controller.abort();
      this.workspace.signOut();
      this.pending.clear(); this.failedBatch = null; this.saving = null; this.uploading = null;
      this.hasData = false; this.authenticating = false;
      this.options.apply(DriveWorkspace.empty());
      this.observed = this.flatten(this.options.snapshot());
      $('upload-notice').hidden = true; $('upload-message').textContent = '';
      $('backup-file').value = ''; $('document-file').value = '';
      $('login-dialog').close(); $('login-message').textContent = '';
      document.querySelectorAll('.personal-progress, [data-documents]').forEach(details => { details.open = false; });
      this.render();
      this.status('Signed out. Your saved files and progress remain in Google Drive.');
    }
    async upload(file, target, onComplete) {
      if (!this.require()) return;
      if (this.uploading) { this.status('Finish or cancel the current upload before choosing another file.'); return; }
      const epoch = this.epoch, controller = new AbortController();
      this.uploading = { controller };
      $('upload-notice').hidden = false; $('cancel-upload').hidden = false;
      $('upload-progress').hidden = false; $('upload-progress').value = 0;
      $('upload-message').textContent = 'Uploading ' + file.name + ' to your private Drive folder…';
      this.render();
      try {
        const result = await this.workspace.upload(file, target, value => {
          if (epoch === this.epoch) $('upload-progress').value = value;
        }, controller.signal);
        if (epoch !== this.epoch) return;
        onComplete(result);
        this.changed();
        $('upload-message').textContent = result.name + ' uploaded to Drive. Saving its application link…';
        const saved = await this.flush();
        if (epoch === this.epoch) $('upload-message').textContent = result.name + (saved ? ' uploaded and attached. Your university application has not been submitted.' : ' is in Drive. Its tracker link still needs saving; retry or download a backup.');
      } catch (error) {
        if (epoch === this.epoch) $('upload-message').textContent = error.name === 'AbortError' ? 'Upload cancelled. If it completed just before cancellation, the file may already be in your Drive folder.' : error.message || 'Upload failed. Check your connection and retry.';
      } finally {
        if (epoch === this.epoch) { this.uploading = null; $('cancel-upload').hidden = true; $('upload-progress').hidden = true; this.render(); }
      }
    }
    async importBrowser() {
      if (!this.require() || this.saving || this.uploading) return;
      const epoch = this.epoch;
      let raw;
      try {
        raw = localStorage.getItem(LEGACY);
        if (!raw) { this.legacy(); return; }
        if (!confirm('Move the old browser progress into ' + this.workspace.account.emailAddress + '? Matching application entries will use the browser copy. Other Drive entries will remain.')) return;
        this.options.restore(JSON.parse(raw));
        this.changed();
        if (await this.flush() && epoch === this.epoch) {
          // Do not remove an older tab’s changes made while the upload ran.
          if (localStorage.getItem(LEGACY) === raw) localStorage.removeItem(LEGACY);
          this.legacy();
          this.status('Browser progress saved to your Google Drive. The migrated browser copy was removed.');
        }
      } catch (error) { if (epoch === this.epoch) this.status(error.message || 'The browser copy could not be moved. It has been kept.'); }
    }
  }
  window.ApplicationAccount = ApplicationAccount;
})();
