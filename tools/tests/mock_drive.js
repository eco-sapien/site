/* In-memory Google API fixture. Test-only; never loaded by the public pages. */
function createDriveMock() {
  const state = { files: new Map(), uploads: new Map(), calls: [], sequence: 0, clock: 0, pageSize: 1000, failSave: '', failChunk: false, holdUpload: false };
  const result = (value, status = 200, headers = {}) => new Response(value == null ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const binary = (bytes, type, signal) => {
    const response = new Response(bytes, { headers: { 'Content-Type': type || 'application/octet-stream' } });
    if (state.holdDownload) {
      const read = response.blob.bind(response);
      response.blob = () => new Promise((resolve, reject) => {
        state.downloadSignal = signal;
        const abort = () => reject(new DOMException('Download aborted', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        state.releaseDownload = () => { signal?.removeEventListener('abort', abort); resolve(read()); };
        if (signal?.aborted) abort();
      });
    }
    return response;
  };
  const create = (metadata, account, payload) => {
    const file = { ...metadata, id: metadata.id || 'file-' + ++state.sequence, createdTime: new Date(Date.UTC(2026, 9, 4) + ++state.clock * 1000).toISOString(), ownedByMe: true, permissions: [{ type: 'user', role: 'owner' }], parents: (metadata.parents || []).map(id => id === 'root' ? 'home-' + account : id), account, payload };
    state.files.set(file.id, file);
    return file;
  };
  state.request = async (input, init = {}) => {
    const url = new URL(input), method = init.method || 'GET';
    const headers = new Headers(init.headers);
    const account = (headers.get('Authorization') || '').replace('Bearer ', '');
    state.calls.push({ url: url.href, method, account, range: headers.get('Content-Range') });
    if (state.failAuth) { state.failAuth = false; return result({ error: {} }, 401); }
    if (!account) return result({ error: {} }, 401);
    if (url.pathname.endsWith('/about')) return result({ user: { permissionId: account, emailAddress: account + '@example.test', displayName: account } });
    if (url.pathname.endsWith('/files/root')) return result({ id: 'home-' + account });
    if (url.pathname.endsWith('/generateIds')) return result({ ids: ['generated-' + ++state.sequence] });
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const kind = /key='eco_kind' and value='([^']+)'/.exec(q)?.[1];
      const files = [...state.files.values()].filter(file => file.account === account && !file.trashed
        && (!parent || file.parents?.includes(parent)) && (!kind || file.appProperties?.eco_kind === kind)
        && (!q.includes('mimeType=') || file.mimeType === 'application/vnd.google-apps.folder'));
      const offset = Number(url.searchParams.get('pageToken') || 0);
      return result({ files: files.slice(offset, offset + state.pageSize).map(({ payload, binary, ...file }) => file), ...(offset + state.pageSize < files.length ? { nextPageToken: String(offset + state.pageSize) } : {}) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') return result(create(JSON.parse(init.body), account));
    if (url.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      const id = /^\/drive\/v3\/files\/([^/]+)/.exec(url.pathname)?.[1];
      const file = state.files.get(id);
      if (!file || file.account !== account) return result({ error: {} }, 404);
      if (url.pathname.endsWith('/export')) return binary(new TextEncoder().encode('%PDF-1.4\nMock Google export'), 'application/pdf', init.signal);
      if (url.searchParams.get('alt') === 'media' && file.binary) return binary(file.binary, file.mimeType, init.signal);
      const { binary: bytes, ...metadata } = file;
      return result(url.searchParams.get('alt') === 'media' ? file.payload : metadata);
    }
    if (url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'multipart') {
      if (state.failSave === 'before') { state.failSave = ''; throw new TypeError('Network failure'); }
      const body = await init.body.text();
      const boundary = headers.get('Content-Type').split('boundary=')[1];
      const parts = body.split('--' + boundary);
      const metadata = JSON.parse(parts[1].split('\r\n\r\n')[1].trim());
      const payload = JSON.parse(parts[2].split('\r\n\r\n')[1].trim());
      if (state.files.has(metadata.id)) return result({}, 409);
      if (state.holdSave) await new Promise(resolve => { state.releaseSave = resolve; });
      const saved = create(metadata, account, payload);
      if (state.failSave === 'after') { state.failSave = ''; throw new TypeError('Response lost after durable save'); }
      return result({ id: saved.id, createdTime: saved.createdTime });
    }
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST' && url.searchParams.get('uploadType') === 'resumable') {
      const metadata = JSON.parse(init.body), id = 'session-' + ++state.sequence;
      const size = Number(headers.get('X-Upload-Content-Length'));
      state.uploads.set(id, { metadata, account, size, offset: 0, binary: new Uint8Array(size) });
      return result(null, 200, { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + id });
    }
    if (url.pathname === '/upload/drive/v3/files' && method === 'PUT') {
      const upload = state.uploads.get(url.searchParams.get('upload_id'));
      if (!upload || upload.account !== account) return result({}, 404);
      if (state.holdUpload) await new Promise(resolve => { state.releaseUpload = resolve; });
      const range = headers.get('Content-Range');
      if (!range.startsWith('bytes */')) {
        const [, start, end] = /bytes (\d+)-(\d+)\//.exec(range);
        if (Number(start) !== upload.offset) throw new Error('Unexpected upload offset');
        if (init.body.size !== Number(end) - Number(start) + 1) throw new Error('Incorrect chunk body');
        upload.binary.set(new Uint8Array(await init.body.arrayBuffer()), Number(start));
        upload.offset = Number(end) + 1;
        if (state.failChunk) { state.failChunk = false; throw new TypeError('Chunk accepted, response lost'); }
      }
      if (upload.offset === upload.size) {
        const saved = state.files.get(upload.metadata.id) || create(upload.metadata, account);
        saved.binary = upload.binary; saved.size = String(upload.size);
        return result({ id: saved.id, name: saved.name, size: String(upload.size) });
      }
      return result(null, 308, upload.offset ? { Range: 'bytes=0-' + (upload.offset - 1) } : {});
    }
    throw new Error('Unhandled mock request: ' + method + ' ' + url);
  };
  state.export = () => JSON.stringify({ files: [...state.files], sequence: state.sequence, clock: state.clock }, (_, value) => value instanceof Uint8Array ? { __bytes: Array.from(value) } : value);
  state.restore = text => { const data = JSON.parse(text, (_, value) => value?.__bytes ? new Uint8Array(value.__bytes) : value); state.files = new Map(data.files); state.sequence = data.sequence; state.clock = data.clock; };
  return state;
}
