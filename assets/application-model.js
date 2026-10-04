/* Shared, pure application-state rules. The public research remains separate. */
(() => {
  'use strict';
  const documentTypes = [
    ['cv', 'CV'], ['statement', 'Statement / essay'], ['portfolio', 'Portfolio / proposal'],
    ['degree', 'Degree certificate'], ['transcript', 'Transcript'], ['language', 'English evidence'],
    ['aps', 'APS / qualification check'], ['reference', 'Reference'], ['employment', 'Work evidence']
  ];
  const stages = ['Not started', 'Check eligibility', 'Preparing', 'Submitted', 'Offer received', 'Unsuccessful', 'Not pursuing'];
  const documentStages = ['Needed', 'Draft', 'Ready', 'Submitted', 'Not required'];
  const defaults = () => ({ saved: false, stage: 'Not started', notes: '', folder: '', deadline: '', deadline_note: '', deadline_confirmed: false, documents: Object.create(null) });
  const documentValue = (p, key) => p.documents?.[key] || { status: 'Needed', url: '', file_id: '' };
  const fileId = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : '';
  function driveUrl(input) {
    if (typeof input !== 'string' || input.length > 2048) return '';
    try {
      const url = new URL(input.trim());
      if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname) || url.username || url.password || url.port) return '';
      return url.href;
    } catch { return ''; }
  }
  function dayNumber(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const stamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return null;
    return Math.floor(stamp / 86400000);
  }
  function today() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function cleanDocuments(input) {
    const clean = Object.create(null);
    for (const [key] of documentTypes) {
      const value = input?.[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) clean[key] = { status: documentStages.includes(value.status) ? value.status : 'Needed', url: driveUrl(value.url), file_id: fileId(value.file_id) };
    }
    return clean;
  }
  function cleanLibrary(input) {
    const clean = { folder: driveUrl(input?.folder), documents: Object.create(null), files: Object.create(null) };
    for (const [key] of documentTypes) {
      clean.documents[key] = driveUrl(input?.documents?.[key]);
      clean.files[key] = fileId(input?.files?.[key]);
    }
    return clean;
  }
  function cleanProgress(input, known) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('This is not an application-progress backup.');
    const clean = Object.create(null);
    for (const [id, value] of Object.entries(input)) {
      if (!known.has(id) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      clean[id] = {
        saved: value.saved === true, stage: stages.includes(value.stage) ? value.stage : 'Not started',
        notes: typeof value.notes === 'string' ? value.notes.slice(0, 4000) : '', folder: driveUrl(value.folder),
        deadline: dayNumber(value.deadline) !== null && value.deadline >= '2000-01-01' && value.deadline <= '2100-12-31' ? value.deadline : '',
        deadline_note: typeof value.deadline_note === 'string' ? value.deadline_note.slice(0, 4000) : '',
        deadline_confirmed: value.deadline_confirmed === true,
        documents: cleanDocuments(value.documents)
      };
    }
    return clean;
  }
  function readiness(p, library = { documents: {} }) {
    let ready = 0, required = 0, draft = 0, linked = 0;
    for (const [key] of documentTypes) {
      const doc = documentValue(p, key);
      if (doc.file_id || doc.url || library.files?.[key] || library.documents[key]) linked++;
      if (doc.status === 'Not required') continue;
      required++;
      if (doc.status === 'Ready' || doc.status === 'Submitted') ready++;
      if (doc.status === 'Draft') draft++;
    }
    return { ready, required, draft, linked, percent: required ? Math.round(100 * ready / required) : 0 };
  }
  function tracked(p) {
    return !!(p.saved || p.stage !== 'Not started' || p.notes || p.folder || p.deadline
      || Object.values(p.documents || {}).some(doc => doc.file_id || doc.url || doc.status !== 'Needed'));
  }
  function active(p) { return tracked(p) && !['Not pursuing', 'Unsuccessful'].includes(p.stage); }
  function deadline(record, p, onDate = today()) {
    const override = dayNumber(p.deadline) !== null;
    const date = override ? p.deadline : record.deadline;
    const stamp = dayNumber(date);
    const confirmed = stamp !== null && (override ? p.deadline_confirmed : /^Published/.test(record.date_basis || ''));
    return { date: stamp === null ? '' : date, days: stamp === null ? null : stamp - dayNumber(onDate), confirmed, override,
      basis: stamp === null ? 'Date to confirm' : override ? confirmed ? 'Your confirmed date' : 'Your planning date' : confirmed ? 'Published date' : 'Planning date · verify',
      note: override ? p.deadline_note : record.window, time: override ? '' : record.deadline_time || '' };
  }
  function formatDate(date) { return dayNumber(date) === null ? 'Date to confirm' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z')); }
  function csvCell(value) {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  window.ApplicationModel = Object.freeze({ documentTypes, stages, documentStages, defaults, documentValue, fileId, driveUrl, dayNumber, today, cleanDocuments, cleanLibrary, cleanProgress, readiness, tracked, active, deadline, formatDate, csvCell });
})();
