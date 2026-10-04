import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
globalThis.window = globalThis;
vm.runInThisContext(await readFile(new URL('../../assets/application-model.js', import.meta.url), 'utf8'));
const M = ApplicationModel;
const data = JSON.parse(await readFile(new URL('../../data/databases.json', import.meta.url), 'utf8'));
const known = new Map(data.records.map(record => [record.id, record]));
assert.equal(known.size, 149);
assert.equal(data.records.filter(r => r.collections.includes('masters')).length, 128);
assert.equal(data.records.filter(r => r.collections.includes('art')).length, 24);
for (const id of ['trier-gemstones', 'daad-11191', 'weimar-media-art']) assert.deepEqual(known.get(id).collections, ['masters', 'art']);
console.log('PASS combined catalogue preserves all research routes and merges shared programme IDs');

const p = M.defaults();
assert.equal(M.readiness(p).required, 9);
assert.equal(M.tracked(p), false);
p.documents.cv = { status: 'Draft', url: 'https://drive.google.com/file/d/example/view' };
p.documents.statement = { status: 'Ready', url: '' };
p.documents.transcript = { status: 'Submitted', url: '' };
p.documents.portfolio = { status: 'Not required', url: '' };
assert.deepEqual(M.readiness(p), { ready: 2, required: 8, draft: 1, linked: 1, percent: 25 });
assert.equal(M.readiness(p, { documents: { transcript: 'https://drive.google.com/file/d/shared/view' } }).linked, 2);
assert.equal(M.tracked(p), true);
assert.equal(M.active(p), true);
p.stage = 'Not pursuing';
assert.equal(M.active(p), false);
for (const [key] of M.documentTypes) p.documents[key] = { status: 'Not required', url: '' };
assert.equal(M.readiness(p).percent, 0);
assert.equal(M.readiness(p).required, 0);
console.log('PASS readiness excludes optional slots, distinguishes drafts and never invents progress');

assert.equal(M.dayNumber('2027-02-29'), null);
assert.notEqual(M.dayNumber('2028-02-29'), null);
assert.equal(M.dayNumber('2026-4-3'), null);
const record = { deadline: '2026-10-10', date_basis: 'Annual deadline · verify', window: 'Verify the portal', deadline_time: '13:00 CET' };
let due = M.deadline(record, M.defaults(), '2026-10-04');
assert.equal(due.days, 6); assert.equal(due.confirmed, false);
due = M.deadline({ ...record, date_basis: 'Published 2026 dates' }, M.defaults(), '2026-10-11');
assert.equal(due.days, -1); assert.equal(due.confirmed, true);
due = M.deadline(record, { ...M.defaults(), deadline: '2026-11-01', deadline_confirmed: false }, '2026-10-04');
assert.equal(due.days, 28); assert.equal(due.confirmed, false); assert.equal(due.time, '');
due = M.deadline(record, { ...M.defaults(), deadline: '2026-11-01', deadline_confirmed: true, deadline_note: 'University confirmed' }, '2026-10-04');
assert.equal(due.confirmed, true); assert.equal(due.note, 'University confirmed');
assert.equal(M.deadline({ deadline: null }, M.defaults(), '2026-10-04').days, null);
console.log('PASS deadline confidence, overrides, unknown dates and past dates stay distinct');

const cleaned = M.cleanProgress({
  'trier-gemstones': { stage: 'Offer received', deadline: '2027-02-30', documents: { cv: { status: 'Ready', url: 'https://drive.google.com.evil.example/private' } } },
  unknown: { notes: 'Unrecognised route' }
}, known);
assert.deepEqual(Object.keys(cleaned), ['trier-gemstones']);
assert.equal(cleaned['trier-gemstones'].stage, 'Offer received');
assert.equal(cleaned['trier-gemstones'].deadline, '');
assert.equal(cleaned['trier-gemstones'].documents.cv.url, '');
assert.equal(M.driveUrl('javascript:alert(1)'), '');
assert.equal(M.driveUrl('https://user:password@drive.google.com/file/d/anything/view'), '');
assert.equal(M.driveUrl('https://docs.google.com/document/d/anything/edit'), 'https://docs.google.com/document/d/anything/edit');
assert.match(M.csvCell('=HYPERLINK("https://example.test")'), /^"'/);
console.log('PASS restored progress accepts known routes and safe links; CSV neutralises formula cells');
