/* Google Drive is the authorization boundary. No tokens or private state are
   persisted in browser storage. The public catalogue does not require login. */
(() => {
  'use strict';
  const API = 'https://www.googleapis.com/drive/v3/';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const APP = 'ecosapien-applications-v1';
  const FOLDER = 'application/vnd.google-apps.folder';
  const DOCS = ['cv', 'statement', 'portfolio', 'degree', 'transcript', 'language', 'aps', 'reference', 'employment'];
  const META = 'id,name,mimeType,parents,ownedByMe,trashed,permissions(type,role),createdTime,appProperties';
  const abortError = () => new DOMException('This session was closed.', 'AbortError');
  const empty = () => ({ version: 3, progress: Object.create(null), library: { folder: '', documents: Object.create(null) } });
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(id);
  // Research IDs are hyphenated slugs. Requiring the hyphen also excludes
  // JavaScript prototype keys when replaying an imported change record.
  const validProgramme = id => typeof id === 'string' && id.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id);

  function validChange(change) {
    if (!change || !Array.isArray(change.path)) return false;
    const p = change.path, v = change.value;
    if (!(typeof v === 'string' && v.length <= 4000 || typeof v === 'boolean')) return false;
    if (p[0] === 'progress' && validProgramme(p[1])) {
      return p.length === 3 && ['saved', 'stage', 'notes', 'folder'].includes(p[2])
        || p.length === 5 && p[2] === 'documents' && DOCS.includes(p[3]) && ['url', 'status'].includes(p[4]);
    }
    return p[0] === 'library' && (p.length === 2 && p[1] === 'folder'
      || p.length === 3 && p[1] === 'documents' && DOCS.includes(p[2]));
  }

  function applyChanges(state, changes) {
    for (const change of changes) {
      if (!validChange(change)) throw new Error('An application save contains an unsupported field. Your Drive files have not been changed.');
      let target = state;
      change.path.slice(0, -1).forEach(key => { target = target[key] || (target[key] = Object.create(null)); });
      target[change.path.at(-1)] = change.value;
    }
    return state;
  }

  class DriveWorkspace {
    static scope = 'https://www.googleapis.com/auth/drive.file';
    static maxFileSize = 100 * 1024 * 1024;
    static empty = empty;
    static applyChanges = applyChanges;
    constructor(onStatus = () => {}) {
      this.onStatus = onStatus;
      this.session = null;
      this.account = null;
      this.roots = [];
      this.entries = new Map();
      this.unlisted = new Map();
      this.expiryTimer = null;
    }
    get connected() { return !!this.session?.token && Date.now() < this.session.expiresAt; }
    get folderUrl() { return this.roots[0] ? 'https://drive.google.com/drive/folders/' + this.roots[0].id : ''; }
    assertSession(session) { if (!session || session !== this.session || session.controller.signal.aborted) throw abortError(); }
    requireSession() {
      const session = this.session;
      this.assertSession(session);
      if (!this.connected) {
        this.expire(session);
        throw new Error('Your Google connection expired. Reconnect to save or upload. Your unsaved work is still here.');
      }
      return session;
    }
    expire(session) {
      if (this.session !== session) return;
      session.token = '';
      clearTimeout(this.expiryTimer);
      this.onStatus({ type: 'expired' });
    }
    signOut() {
      this.session?.controller.abort();
      this.session = null;
      this.account = null;
      this.roots = [];
      this.entries.clear();
      this.unlisted.clear();
      clearTimeout(this.expiryTimer);
    }
    async request(path, init = {}, session = this.requireSession(), accept = []) {
      this.assertSession(session);
      if (!session.token) throw new Error('Reconnect to Google to continue.');
      const url = new URL(path.startsWith('https:') ? path : API + path);
      if (url.origin !== 'https://www.googleapis.com' || url.username || url.password
          || !/^\/(upload\/)?drive\/v3\//.test(url.pathname)) throw new Error('Invalid Drive endpoint.');
      const controller = new AbortController();
      const signals = [session.controller.signal, init.signal].filter(Boolean);
      const abort = () => controller.abort();
      signals.forEach(signal => { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
      const timeout = setTimeout(abort, 60000);
      try {
        const response = await fetch(url.href, {
          ...init, headers: { ...init.headers, Authorization: 'Bearer ' + session.token },
          signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error'
        });
        this.assertSession(session);
        if (response.status === 401) this.expire(session);
        if (!response.ok && !accept.includes(response.status)) {
          let reason = '';
          try { reason = (await response.json()).error?.errors?.[0]?.reason || ''; } catch { /* Use a safe, useful message. */ }
          const message = response.status === 401 ? 'Your Google connection expired. Reconnect and retry.'
            : reason === 'storageQuotaExceeded' ? 'Your Google Drive storage is full. Free some space and retry.'
            : ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason) || response.status === 429 ? 'Google is limiting requests. Wait a moment, then retry.'
            : response.status === 403 ? 'Google denied access. Check that Drive API is enabled and approve the requested file permission.'
            : response.status === 404 ? 'A workspace file or folder is missing from Drive. Restore it from Drive’s bin, then reconnect.'
            : `Google Drive could not complete this request (${response.status}). Retry when your connection is stable.`;
          throw new Error(message);
        }
        return response;
      } catch (error) {
        if (error.name === 'AbortError' && !session.controller.signal.aborted && !init.signal?.aborted) throw new Error('The Google Drive request timed out. Check your connection and retry.');
        throw error;
      } finally {
        clearTimeout(timeout);
        signals.forEach(signal => signal.removeEventListener('abort', abort));
      }
    }
    async json(path, init, session) {
      const response = await this.request(path, init, session);
      const result = await response.json();
      this.assertSession(session || this.session);
      return result;
    }
    async list(q, session) {
      let pageToken = '', files = [];
      do {
        const params = new URLSearchParams({ q: 'trashed = false and ' + q, spaces: 'drive', pageSize: '1000', fields: `nextPageToken,files(${META})` });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await this.json('files?' + params, {}, session);
        files.push(...(page.files || []));
        pageToken = page.nextPageToken || '';
      } while (pageToken);
      return files.sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
    }
    query(kind) { return `appProperties has { key='eco_app' and value='${APP}' } and appProperties has { key='eco_kind' and value='${kind}' }`; }
    async privateFolder(folder, parent, session) {
      if (!validId(folder.id)) throw new Error('Invalid workspace folder.');
      const fresh = await this.json('files/' + folder.id + '?fields=' + encodeURIComponent(META), {}, session);
      if (fresh.trashed || fresh.mimeType !== FOLDER || !fresh.ownedByMe || fresh.parents?.length !== 1 || fresh.parents[0] !== parent
          || !fresh.permissions?.length || fresh.permissions.some(p => p.type !== 'user' || p.role !== 'owner')) {
        throw new Error('This workspace folder has been shared or moved. Keep EcoSapien Applications directly in My Drive with sharing Restricted, then retry.');
      }
      return fresh;
    }
    async folder(kind, name, parent, session, create = true) {
      const folders = await this.list(`'${parent}' in parents and mimeType='${FOLDER}' and ` + this.query(kind), session);
      if (folders.length) return this.privateFolder(folders[0], parent, session);
      if (!create) return null;
      const folder = await this.json('files?fields=' + encodeURIComponent(META), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent], appProperties: { eco_app: APP, eco_kind: kind } })
      }, session);
      return this.privateFolder(folder, parent, session);
    }
    async connect(response) {
      this.session?.controller.abort();
      clearTimeout(this.expiryTimer);
      const session = { token: response.access_token, expiresAt: Date.now() + Math.max(1, Number(response.expires_in || 3600) - 30) * 1000, controller: new AbortController() };
      this.session = session;
      try {
        const about = await this.json('about?fields=user(displayName,emailAddress,permissionId)', {}, session);
        if (!about.user?.permissionId) throw new Error('Google did not return an account identity.');
        if (this.account && about.user.permissionId !== this.account.permissionId) {
          throw new Error('Choose the same Google account to reconnect. To switch accounts, sign out of this workspace first.');
        }
        this.account = about.user;
        const home = await this.json('files/root?fields=id', {}, session);
        session.homeId = home.id;
        this.roots = await this.list(`'me' in owners and mimeType='${FOLDER}' and ` + this.query('root'), session);
        if (!this.roots.length) this.roots = [await this.folder('root', 'EcoSapien Applications', home.id, session)];
        for (const root of this.roots) await this.privateFolder(root, home.id, session);
        this.expiryTimer = setTimeout(() => this.expire(session), Math.max(1, session.expiresAt - Date.now()));
        return await this.load();
      } catch (error) {
        if (this.session === session) { session.token = ''; session.controller.abort(); }
        throw error;
      }
    }
    async load() {
      const session = this.requireSession();
      // Independent saves are append-only patches. Concurrent devices retain
      // edits to different fields; the latest Drive-created patch wins per field.
      const files = [];
      for (const root of this.roots) {
        await this.privateFolder(root, session.homeId, session);
        const folders = await this.list(`'${root.id}' in parents and mimeType='${FOLDER}' and ` + this.query('history'), session);
        for (const folder of folders) {
          await this.privateFolder(folder, root.id, session);
          files.push(...await this.list(`'${folder.id}' in parents and ` + this.query('changes'), session));
        }
      }
      const listed = new Set(files.map(file => file.id));
      this.unlisted.forEach((file, id) => { if (listed.has(id)) this.unlisted.delete(id); else files.push(file); });
      const missing = files.filter(file => !this.entries.has(file.id));
      for (let i = 0; i < missing.length; i += 4) {
        await Promise.all(missing.slice(i, i + 4).map(async file => {
          const response = await this.request('files/' + file.id + '?alt=media', {}, session);
          const text = await response.text();
          this.assertSession(session);
          if (text.length > 6 * 1024 * 1024) throw new Error('An application save is too large to read safely.');
          const record = JSON.parse(text);
          if (record.version !== 3 || !Array.isArray(record.changes) || !record.changes.every(validChange)) throw new Error('An application save is unreadable. Your existing files are unchanged.');
          this.entries.set(file.id, { ...file, changes: record.changes });
        }));
      }
      // Only replay currently present entries; never silently recreate deleted logs.
      const state = empty();
      files.sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
      files.forEach(file => applyChanges(state, this.entries.get(file.id).changes));
      this.assertSession(session);
      return state;
    }
    async save(batch) {
      const session = this.requireSession();
      if (!batch.changes?.length || !batch.changes.every(validChange)) throw new Error('No valid changes to save.');
      const root = await this.privateFolder(this.roots[0], session.homeId, session);
      const history = await this.folder('history', 'Tracker history', root.id, session);
      if (!batch.id) {
        const ids = await this.json('files/generateIds?count=1&space=drive&type=files', {}, session);
        batch.id = ids.ids[0];
      }
      if (!validId(batch.id)) throw new Error('Google did not provide a valid save ID.');
      const payload = JSON.stringify({ version: 3, changes: batch.changes });
      const boundary = 'ecosapien_' + crypto.randomUUID().replaceAll('-', '');
      const metadata = { id: batch.id, name: 'Progress ' + new Date().toISOString().replaceAll(':', '-') + '.json', mimeType: 'application/json', parents: [history.id], appProperties: { eco_app: APP, eco_kind: 'changes' } };
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify(metadata),
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`, payload, `\r\n--${boundary}--\r\n`
      ]);
      const response = await this.request(UPLOAD + '?uploadType=multipart&fields=id,createdTime', {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
      }, session, [409]);
      let saved;
      if (response.status === 409) {
        // A lost response can be retried without creating a second revision.
        const existing = await this.json('files/' + batch.id + '?alt=media', {}, session);
        if (JSON.stringify(existing) !== payload) throw new Error('A save ID conflict occurred. Download a backup before reconnecting.');
        saved = await this.json('files/' + batch.id + '?fields=id,createdTime', {}, session);
      } else saved = await response.json();
      this.assertSession(session);
      if (saved.id !== batch.id || !saved.createdTime) throw new Error('Google did not confirm the saved revision. Retry or download a backup.');
      const entry = { id: batch.id, createdTime: saved.createdTime, changes: batch.changes };
      this.entries.set(batch.id, entry);
      this.unlisted.set(batch.id, entry);
    }
    async upload(file, target, onProgress, signal) {
      const session = this.requireSession();
      if (!file.size || file.size > DriveWorkspace.maxFileSize) throw new Error('Choose a non-empty file of up to 100 MB.');
      if (!/\.(pdf|docx?|odt|rtf|txt|pptx?|odp|jpe?g|png|webp|zip)$/i.test(file.name)) throw new Error('Use PDF, Word, ODT, text, PowerPoint, JPG, PNG, WebP or ZIP.');
      if (target.id !== 'library' && !validProgramme(target.id)) throw new Error('Unknown application.');
      const root = await this.privateFolder(this.roots[0], session.homeId, session);
      const folder = await this.folder(target.id, target.id === 'library' ? 'Shared documents' : target.name.slice(0, 150), root.id, session);
      const ids = await this.json('files/generateIds?count=1&space=drive&type=files', {}, session);
      const fileId = ids.ids[0];
      if (!validId(fileId)) throw new Error('Google did not provide a valid file ID.');
      const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream';
      const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 220);
      const response = await this.request(UPLOAD + '?uploadType=resumable&fields=id,name,webViewLink,size', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(file.size) },
        body: JSON.stringify({ id: fileId, name, mimeType, parents: [folder.id], appProperties: { eco_app: APP, eco_kind: 'document', eco_slot: target.key } })
      }, session);
      const location = response.headers.get('Location');
      if (!location?.startsWith(UPLOAD + '?')) throw new Error('Google did not return a valid upload session. Retry.');
      let offset = 0, attempts = 0, queryStatus = false;
      onProgress(0);
      while (offset < file.size) {
        if (signal?.aborted) throw abortError();
        const end = Math.min(offset + 4 * 1024 * 1024, file.size);
        let reply;
        try {
          reply = await this.request(location, {
            method: 'PUT', signal,
            headers: { 'Content-Type': mimeType, 'Content-Range': queryStatus ? `bytes */${file.size}` : `bytes ${offset}-${end - 1}/${file.size}` },
            body: queryStatus ? null : file.slice(offset, end)
          }, session, [308, 500, 502, 503, 504]);
        } catch (error) {
          if (error.name === 'AbortError' || !this.connected || !(error instanceof TypeError) || ++attempts > 2) throw error;
          queryStatus = true;
          continue;
        }
        if (reply.ok) {
          const result = await reply.json();
          this.assertSession(session);
          if (result.id !== fileId) throw new Error('Upload verification failed. Check your Drive folder.');
          onProgress(100);
          return { id: result.id, name, url: 'https://drive.google.com/file/d/' + result.id + '/view', folder: 'https://drive.google.com/drive/folders/' + folder.id };
        }
        if (reply.status >= 500) {
          if (++attempts > 2) throw new Error('The upload was interrupted. Retry when your connection is stable.');
          queryStatus = true;
          continue;
        }
        const range = /^bytes=0-(\d+)$/.exec(reply.headers.get('Range') || '');
        const received = range ? Number(range[1]) + 1 : 0;
        if (received < offset || received > file.size || received === offset && !queryStatus && ++attempts > 2) throw new Error('Google did not confirm upload progress. Retry.');
        offset = received;
        queryStatus = false;
        onProgress(Math.round(offset / file.size * 100));
      }
      throw new Error('The upload has not been confirmed. Check Drive before retrying.');
    }
  }
  window.DriveWorkspace = DriveWorkspace;
})();
