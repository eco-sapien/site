import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
globalThis.window = globalThis;
vm.runInThisContext(await readFile(new URL('mock_drive.js', import.meta.url), 'utf8'));
vm.runInThisContext(await readFile(new URL('../../assets/drive-workspace.js', import.meta.url), 'utf8'));
const mock = createDriveMock();
globalThis.fetch = mock.request;
const token = account => ({ access_token: account, expires_in: 3600 });
const change = (field, value) => ({ path: ['progress', 'daad-11011', field], value });
const a = new DriveWorkspace(), b = new DriveWorkspace();
try {
  assert.deepEqual(Object.keys((await a.connect(token('account-a'))).progress), []);
  await b.connect(token('account-a'));
  assert.equal(a.folderUrl, b.folderUrl);
  await a.save({ changes: [change('notes', 'A private note')] });
  await b.save({ changes: [change('stage', 'Preparing')] });
  let state = await a.load();
  assert.equal(state.progress['daad-11011'].notes, 'A private note');
  assert.equal(state.progress['daad-11011'].stage, 'Preparing');
  await a.save({ changes: [{ path: ['progress', 'weimar-media-art', 'notes'], value: 'Custom university route' }] });
  assert.equal((await a.load()).progress['weimar-media-art'].notes, 'Custom university route');
  console.log('PASS independent devices retain changes to different fields and support custom programme IDs');

  mock.pageSize = 1;
  await b.save({ changes: [change('notes', 'Later note')] });
  assert.equal((await a.load()).progress['daad-11011'].notes, 'Later note');
  console.log('PASS pagination and latest Drive save wins for one field');

  const batch = { changes: [change('saved', true)] };
  mock.failSave = 'after';
  await assert.rejects(a.save(batch), /Response lost/);
  const count = mock.files.size;
  await a.save(batch);
  assert.equal(mock.files.size, count);
  assert.equal((await a.load()).progress['daad-11011'].saved, true);
  console.log('PASS retry after lost save response is idempotent');

  const file = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'application/pdf' });
  file.name = 'Portfolio.pdf';
  mock.failChunk = true;
  const uploaded = await a.upload(file, { id: 'daad-11011', name: 'Example university', key: 'portfolio' }, () => {});
  assert.match(uploaded.url, /https:\/\/drive.google.com\/file\/d\/generated-/);
  assert(mock.calls.some(call => call.range === `bytes */${file.size}`));
  assert.equal(mock.files.get(uploaded.id).parents.length, 1);
  const again = await a.upload(file, { id: 'daad-11011', name: 'Example university', key: 'portfolio' }, () => {});
  assert.notEqual(uploaded.id, again.id);
  assert(mock.files.has(uploaded.id));
  console.log('PASS resumable upload recovers accepted chunk and keeps earlier versions');

  const root = mock.files.get(a.roots[0].id);
  root.permissions.push({ type: 'anyone', role: 'reader' });
  const before = mock.files.size;
  await assert.rejects(a.save({ changes: [change('notes', 'Do not expose this')] }), /shared or moved/);
  await assert.rejects(a.upload(file, { id: 'library', key: 'cv' }, () => {}), /shared or moved/);
  assert.equal(mock.files.size, before);
  root.permissions.pop();
  console.log('PASS shared destination blocks private writes and uploads');

  await assert.rejects(a.connect(token('account-b')), /same Google account/);
  assert.equal(a.account.permissionId, 'account-a');
  await a.connect(token('account-a'));
  const second = new DriveWorkspace();
  await second.connect(token('account-b'));
  assert.deepEqual(Object.keys((await second.load()).progress), []);
  second.signOut();
  console.log('PASS reconnect and independent account isolation');

  await assert.rejects(a.save({ changes: [{ path: ['progress', '__proto__', 'notes'], value: 'bad' }] }), /valid changes/);
  await assert.rejects(a.request('https://attacker.example/upload/drive/v3/files'), /Invalid Drive endpoint/);
  assert(!mock.calls.some(call => call.url.includes('attacker')));
  console.log('PASS untrusted paths and off-origin upload endpoints rejected');

  mock.holdSave = true;
  const late = a.save({ changes: [change('notes', 'Late account A response')] });
  while (!mock.releaseSave) await new Promise(resolve => setTimeout(resolve, 1));
  a.signOut();
  mock.releaseSave();
  await assert.rejects(late, { name: 'AbortError' });
  mock.holdSave = false;
  await a.connect(token('account-b'));
  assert.deepEqual(Object.keys((await a.load()).progress), []);
  console.log('PASS in-flight save cannot rehydrate a signed-out or different account');

  mock.failAuth = true;
  await assert.rejects(a.load(), /expired/);
  assert.equal(a.connected, false);
  console.log('PASS expired authorization stops Drive operations');
} finally { a.signOut(); b.signOut(); }
