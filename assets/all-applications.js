(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const data = JSON.parse($('application-data').textContent);
  const records = data.records;
  const known = new Map(records.map(r => [r.id, r]));
  const cards = new Map(records.map(r => [r.id, $('route-' + r.id)]));
  const stages = ['Not started', 'Check eligibility', 'Preparing', 'Submitted', 'Offer received', 'Unsuccessful', 'Not pursuing'];
  const documentTypes = [
    ['cv', 'CV'], ['statement', 'Statement / essay'], ['portfolio', 'Portfolio / proposal'],
    ['degree', 'Degree certificate'], ['transcript', 'Transcript'], ['language', 'English evidence'],
    ['aps', 'APS / qualification check'], ['reference', 'Reference'], ['employment', 'Work evidence']
  ];
  const documentStages = ['Needed', 'Draft', 'Ready', 'Submitted', 'Not required'];
  let progress = Object.create(null), visible = [], limit = 12, account;
  let library = { folder: '', documents: Object.create(null) };
  let currentPreset = 'potential', programmaticReset = false;
  const controls = ['search', 'scope', 'field', 'intake', 'english', 'tuition', 'sort'];
  const defaultProgress = () => ({ saved: false, stage: 'Not started', notes: '', folder: '', documents: Object.create(null) });
  const getProgress = id => progress[id] || defaultProgress();
  const getDocument = (p, key) => p.documents[key] || { status: 'Needed', url: '' };

  function driveUrl(input) {
    if (typeof input !== 'string' || input.length > 2048) return '';
    try {
      const url = new URL(input.trim());
      if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname)
          || url.username || url.password || url.port) return '';
      return url.href;
    } catch { return ''; }
  }

  function cleanDocuments(value) {
    const clean = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
    documentTypes.forEach(([key]) => {
      const entry = value[key];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        clean[key] = { status: documentStages.includes(entry.status) ? entry.status : 'Needed', url: driveUrl(entry.url) };
      }
    });
    return clean;
  }

  function cleanLibrary(value) {
    const clean = { folder: '', documents: Object.create(null) };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
    clean.folder = driveUrl(value.folder);
    documentTypes.forEach(([key]) => { clean.documents[key] = driveUrl(value.documents?.[key]); });
    return clean;
  }

  function cleanProgress(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('This is not an application-progress backup.');
    const clean = Object.create(null);
    for (const [id, value] of Object.entries(input)) {
      if (!known.has(id) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      clean[id] = {
        saved: value.saved === true,
        stage: stages.includes(value.stage) ? value.stage : 'Not started',
        notes: typeof value.notes === 'string' ? value.notes.slice(0, 4000) : '',
        folder: driveUrl(value.folder), documents: cleanDocuments(value.documents)
      };
    }
    return clean;
  }
  function storeProgress() {
    account?.changed();
    const savedCount = records.filter(r => getProgress(r.id).saved).length;
    $('saved-count').textContent = savedCount;
  }

  function setLink(link, url) {
    link.hidden = !url;
    if (url) link.href = url; else link.removeAttribute('href');
  }

  function documentCount(p) {
    let relevant = 0, ready = 0;
    documentTypes.forEach(([key]) => {
      const status = getDocument(p, key).status;
      if (status !== 'Not required') relevant++;
      if (status === 'Ready' || status === 'Submitted') ready++;
    });
    return relevant ? `${ready} / ${relevant} documents marked ready` : 'All document slots marked not required';
  }

  function syncDocuments(card, p) {
    card.querySelector('[data-document-count]').textContent = documentCount(p);
    card.querySelector('[data-folder]').value = p.folder;
    setLink(card.querySelector('[data-open-folder]'), p.folder);
    card.querySelectorAll('[data-document-row]').forEach(row => {
      const key = row.dataset.documentRow, doc = getDocument(p, key);
      row.querySelector('select').value = doc.status;
      row.querySelector('input').value = doc.url;
      row.querySelector('input').setCustomValidity('');
      const shared = library.documents[key] || '';
      row.querySelector('input').placeholder = shared ? 'Using your document-shelf link' : 'Paste a restricted Google Drive link';
      const link = row.querySelector('a');
      setLink(link, doc.url || shared);
      link.textContent = doc.url ? 'Open document ↗' : 'Open shelf document ↗';
      row.querySelector('[data-upload]').textContent = doc.url ? 'Upload another version ↑' : 'Upload final file ↑';
    });
  }

  function saveUrl(input, onValid) {
    if (!account.require()) return;
    const raw = input.value.trim(), url = driveUrl(raw);
    if (raw && !url) {
      input.setCustomValidity('Use an HTTPS link from drive.google.com or docs.google.com.');
      input.reportValidity();
      $('save-status').textContent = 'That link was not saved. Paste a Google Drive or Google Docs HTTPS link.';
      return;
    }
    input.setCustomValidity('');
    input.value = url;
    onValid(url);
    storeProgress();
  }

  function initialiseDocumentFields(card, r) {
    const container = card.querySelector('[data-document-fields]');
    if (container.childElementCount) return;
    documentTypes.forEach(([key, label]) => {
      const row = document.createElement('div'); row.className = 'document-row'; row.dataset.documentRow = key;
      const statusLabel = document.createElement('label'); statusLabel.textContent = label;
      const status = document.createElement('select'); status.id = `doc-status-${r.id}-${key}`;
      statusLabel.htmlFor = status.id;
      documentStages.forEach(s => status.add(new Option(s, s)));
      statusLabel.append(status);
      const urlLabel = document.createElement('label'); urlLabel.textContent = label + ' link';
      urlLabel.className = 'document-url-label';
      const input = document.createElement('input'); input.type = 'url'; input.maxLength = 2048;
      input.id = `doc-link-${r.id}-${key}`; input.autocomplete = 'off'; urlLabel.htmlFor = input.id; urlLabel.append(input);
      const link = document.createElement('a'); link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', 'Open ' + label + ' for ' + r.programme);
      const upload = document.createElement('button'); upload.type = 'button'; upload.className = 'button upload-button';
      upload.dataset.upload = key; upload.textContent = 'Upload final file ↑';
      upload.setAttribute('aria-label', 'Upload ' + label + ' for ' + r.programme);
      upload.addEventListener('click', () => chooseUpload({ id: r.id, key, name: r.university + ' — ' + r.programme }));
      row.append(statusLabel, upload, urlLabel, link); container.append(row);
      status.addEventListener('change', () => {
        if (!account.require()) return;
        const p = getProgress(r.id);
        progress[r.id] = { ...p, documents: { ...p.documents, [key]: { ...getDocument(p, key), status: status.value } } };
        syncDocuments(card, progress[r.id]); storeProgress();
      });
      input.addEventListener('input', () => input.setCustomValidity(''));
      input.addEventListener('change', () => saveUrl(input, url => {
        const p = getProgress(r.id);
        progress[r.id] = { ...p, documents: { ...p.documents, [key]: { ...getDocument(p, key), url } } };
        syncDocuments(card, progress[r.id]);
      }));
    });
    syncDocuments(card, getProgress(r.id));
  }

  function syncCard(r) {
    const card = cards.get(r.id), p = getProgress(r.id);
    const save = card.querySelector('.save-route');
    save.setAttribute('aria-pressed', String(p.saved));
    save.textContent = p.saved ? 'Saved ✓' : '+ Shortlist';
    card.querySelector('[data-stage]').value = p.stage;
    card.querySelector('[data-notes]').value = p.notes;
    card.querySelector('[data-progress-label]').textContent = p.stage === 'Not started' ? 'My files & progress' : 'My progress · ' + p.stage;
    syncDocuments(card, p);
  }

  records.forEach(r => {
    const card = cards.get(r.id), save = card.querySelector('.save-route');
    save.hidden = false;
    card.querySelector('.personal-progress').hidden = false;
    card.querySelector('.my-files-button').hidden = false;
    card.querySelector('.my-files-button').addEventListener('click', () => {
      card.querySelector('.personal-progress').open = true;
      if (!account.require()) return;
      card.querySelector('[data-documents]').open = true;
      initialiseDocumentFields(card, r);
      card.querySelector('.personal-progress').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    save.addEventListener('click', () => {
      if (!account.require()) return;
      const p = getProgress(r.id);
      progress[r.id] = { ...p, saved: !p.saved };
      syncCard(r); storeProgress();
      if ($('scope').value === 'saved') render();
    });
    card.querySelector('[data-stage]').addEventListener('change', event => {
      if (!account.require()) return;
      progress[r.id] = { ...getProgress(r.id), stage: event.target.value };
      card.querySelector('[data-progress-label]').textContent = event.target.value === 'Not started' ? 'My files & progress' : 'My progress · ' + event.target.value;
      storeProgress();
    });
    card.querySelector('[data-notes]').addEventListener('input', event => {
      if (!account.require()) return;
      progress[r.id] = { ...getProgress(r.id), notes: event.target.value.slice(0, 4000) };
      storeProgress();
    });
    const folder = card.querySelector('[data-folder]');
    folder.addEventListener('input', () => folder.setCustomValidity(''));
    folder.addEventListener('change', () => saveUrl(folder, url => {
      progress[r.id] = { ...getProgress(r.id), folder: url };
      setLink(card.querySelector('[data-open-folder]'), url);
    }));
    const documents = card.querySelector('[data-documents]');
    documents.addEventListener('toggle', () => { if (documents.open) initialiseDocumentFields(card, r); });
    syncCard(r);
  });

  function syncLibrary() {
    $('drive-folder').value = library.folder;
    setLink($('drive-upload'), account?.hasData ? account.workspace.folderUrl : '');
    document.querySelectorAll('[data-library-document]').forEach(input => {
      const key = input.dataset.libraryDocument;
      input.value = library.documents[key] || '';
      input.setCustomValidity('');
      setLink(input.closest('.library-item').querySelector('a'), library.documents[key]);
      input.closest('.library-item').querySelector('[data-library-upload]').textContent = library.documents[key] ? 'Upload another version ↑' : 'Upload final file ↑';
    });
    records.forEach(r => syncDocuments(cards.get(r.id), getProgress(r.id)));
  }
  $('drive-folder').addEventListener('input', e => e.target.setCustomValidity(''));
  $('drive-folder').addEventListener('change', e => saveUrl(e.target, url => { library.folder = url; syncLibrary(); }));
  document.querySelectorAll('[data-library-document]').forEach(input => {
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('change', () => saveUrl(input, url => {
      library.documents[input.dataset.libraryDocument] = url; syncLibrary();
    }));
  });
  document.querySelectorAll('[data-library-upload]').forEach(button => {
    button.addEventListener('click', () => chooseUpload({ id: 'library', key: button.dataset.libraryUpload, name: 'Shared documents' }));
  });
  syncLibrary();

  let uploadTarget = null;
  function chooseUpload(target) {
    if (!account.require()) return;
    if (account.uploading) { account.status('Finish or cancel the current upload first.'); return; }
    uploadTarget = { ...target, epoch: account.epoch };
    $('document-file').value = '';
    $('document-file').click();
  }
  $('document-file').addEventListener('change', event => {
    const file = event.target.files[0], target = uploadTarget;
    uploadTarget = null; event.target.value = '';
    if (!file || !target || target.epoch !== account.epoch) return;
    account.upload(file, target, result => {
      if (target.id === 'library') {
        library.documents[target.key] = result.url;
        library.folder = result.folder;
      } else {
        const p = getProgress(target.id);
        progress[target.id] = { ...p, folder: result.folder, documents: { ...p.documents, [target.key]: { status: 'Ready', url: result.url } } };
      }
      syncLibrary(); records.forEach(syncCard);
    });
  });

  function resetForm() {
    programmaticReset = true;
    $('filters').reset();
    programmaticReset = false;
  }

  function applyPreset(name) {
    resetForm();
    currentPreset = name;
    if (name === 'summer') $('intake').value = 'Summer 2027';
    if (name === 'score') $('english').value = 'Score within 6.0';
    if (name === 'saved') $('scope').value = 'saved';
    if (name === 'all') $('scope').value = 'all';
    if (name === 'start') $('scope').value = 'start';
    limit = 12; render();
  }

  function render() {
    const query = $('search').value.trim().toLocaleLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const scope = $('scope').value, field = $('field').value, intake = $('intake').value;
    const english = $('english').value, tuition = $('tuition').value;
    visible = records.filter(r => {
      if (scope === 'potential' && !r.candidate) return false;
      if (scope === 'start' && !data.starting_ids.includes(r.id)) return false;
      if (scope === 'saved' && !getProgress(r.id).saved) return false;
      if (scope === 'excluded' && r.candidate) return false;
      if (field && r.field !== field) return false;
      if (intake === 'Winter 2026/27') return false; // No verified profile-compatible opening in this snapshot.
      if (intake && r.intake !== intake) return false;
      if (english && r.language_fit !== english) return false;
      if (tuition === 'zero' && r.tuition_eur !== 0) return false;
      if (tuition === 'low' && !(r.tuition_eur !== null && r.tuition_eur <= 1500)) return false;
      if (tuition === 'unknown' && r.tuition_eur !== null) return false;
      const haystack = [r.programme,r.university,r.city,r.field,r.fit,r.requirements,r.assessment].join(' ').toLocaleLowerCase();
      return terms.every(term => haystack.includes(term));
    });
    const sort = $('sort').value;
    visible.sort((a,b) => {
      if (sort === 'deadline') return (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.rank-b.rank;
      if (sort === 'fees') return (a.semester_eur ?? Infinity)-(b.semester_eur ?? Infinity) || a.rank-b.rank;
      if (sort === 'university') return a.university.localeCompare(b.university) || a.programme.localeCompare(b.programme);
      return a.rank-b.rank;
    });
    cards.forEach(card => { card.hidden = true; });
    const fragment = document.createDocumentFragment();
    visible.forEach((r,i) => {
      const card = cards.get(r.id); card.hidden = i >= limit; fragment.append(card);
    });
    $('programme-grid').append(fragment);
    const shown = Math.min(limit, visible.length);
    $('result-count').textContent = `${visible.length} ${visible.length === 1 ? 'route' : 'routes'} match · ${shown} shown`;
    $('no-results').hidden = visible.length !== 0;
    $('empty-explanation').textContent = intake === 'Winter 2026/27'
      ? 'No suitable open application for this intake was verified on 4 October 2026. Fulda’s standard deadline was 30 September; any late place needs explicit confirmation. Try summer 2027 or the next winter intake.'
      : scope === 'saved' ? 'Sign in and use “+ Shortlist” to save a programme in your Google Drive. Clear other filters if you have already saved routes.'
      : 'Try fewer filters or choose “All reviewed” to include routes with known barriers.';
    $('more-area').hidden = visible.length <= limit;
    $('more-count').textContent = `${shown} of ${visible.length} matching routes shown`;
    document.querySelectorAll('[data-preset]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === currentPreset)));
  }

  controls.forEach(id => $(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
    limit = 12; currentPreset = ''; render();
  }));
  $('filters').addEventListener('submit', event => event.preventDefault());
  $('filters').addEventListener('reset', () => {
    if (programmaticReset) return;
    // The form values change after the reset event has been dispatched.
    setTimeout(() => { limit=12; currentPreset='potential'; render(); }, 0);
  });
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  $('reset-empty').addEventListener('click', () => applyPreset('potential'));
  $('show-more').addEventListener('click', () => {
    const firstNew = visible[limit]; limit += 12; render();
    if (firstNew) { const heading=cards.get(firstNew.id).querySelector('h3'); heading.setAttribute('tabindex','-1'); heading.focus({preventScroll:true}); }
  });
  $('show-all').addEventListener('click', () => { limit=records.length; render(); });

  function revealHash() {
    if (location.hash === '#login') {
      if (!account.offline) account.login();
      return;
    }
    const id = location.hash.slice(1).replace(/^route-/, '');
    if (!known.has(id)) return;
    resetForm(); $('scope').value='all'; currentPreset=''; limit=records.length; render();
    requestAnimationFrame(() => cards.get(id).scrollIntoView({block:'start'}));
  }
  window.addEventListener('hashchange', revealHash);

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], {type}));
    const a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function csvCell(value) {
    let s = value == null ? '' : String(value);
    // Notes are user-controlled: prevent spreadsheet formula execution on import.
    if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  $('export-csv').addEventListener('click', () => {
    const columns=data.csv_columns;
    const rows=[columns.map(c => csvCell(c.label)).join(',')];
    visible.forEach(r => {
      const p=getProgress(r.id);
      const docValues = { application_folder: p.folder, document_progress: documentCount(p) };
      documentTypes.forEach(([key]) => {
        const doc = getDocument(p, key);
        docValues[key + '_status'] = doc.status;
        docValues[key + '_url'] = doc.url || library.documents[key] || '';
      });
      const values={...r,...docValues,shortlisted:p.saved?'Yes':'No',application_stage:p.stage,notes:p.notes,sources:r.sources.map(s=>s.url).join(' | '),candidate:r.candidate?'Conditional investigation':'Known barrier / screened out'};
      rows.push(columns.map(c=>csvCell(values[c.key])).join(','));
    });
    download('all-applications-filtered-with-progress.csv','\uFEFF'+rows.join('\r\n')+'\r\n','text/csv;charset=utf-8');
    $('save-status').textContent=`Exported ${visible.length} matching routes`+(account.hasData?', including your private notes and document links. Keep this download private.':'.');
  });
  $('backup-progress').addEventListener('click', () => {
    if (!account.hasData) return;
    download('ecosapien-application-progress.json',JSON.stringify({version:3,exported_at:new Date().toISOString(),research_checked:data.checked_at,progress,library},null,2),'application/json');
    $('save-status').textContent='Backup downloaded with notes, checklists and Drive links. Keep it privately in Drive; document files are not included.';
  });
  $('restore-progress').addEventListener('click', () => { if (account.require()) $('backup-file').click(); });
  function restoreState(parsed) {
    if (!parsed || ![1,2,3].includes(parsed.version)) throw new Error('This is not a supported application-progress backup.');
    const restored=cleanProgress(parsed.progress);
    const restoredLibrary=parsed.version>=2?cleanLibrary(parsed.library):null;
    const hasLibrary=restoredLibrary && (restoredLibrary.folder || Object.values(restoredLibrary.documents).some(Boolean));
    if (!Object.keys(restored).length && !hasLibrary) throw new Error('No matching programme progress or document links were found in this file.');
    Object.entries(restored).forEach(([id,p]) => {
      const existing=getProgress(id);
      progress[id]=parsed.version===1?{...existing,saved:p.saved,stage:p.stage,notes:p.notes}:p;
    });
    if (restoredLibrary && parsed.library) library=restoredLibrary;
    syncLibrary(); records.forEach(syncCard); render();
    return Object.keys(restored).length;
  }
  $('backup-file').addEventListener('change', async event => {
    const file=event.target.files[0], epoch=account.epoch;
    if (!file || !account.require()) return;
    try {
      if (file.size>6*1024*1024) throw new Error('Choose a progress JSON file smaller than 6 MB.');
      const parsed=JSON.parse(await file.text());
      if (epoch!==account.epoch || !account.hasData) return;
      if (!confirm('Restore this backup into '+account.workspace.account.emailAddress+'? Matching application entries will be replaced; other entries will remain.')) return;
      const count=restoreState(parsed);
      storeProgress();
      $('save-status').textContent=`Restored ${count} programme entries. Saving to your Google Drive…`;
    } catch (error) { if(epoch===account.epoch) $('save-status').textContent=error.message || 'The backup could not be read. Your existing progress was kept.'; }
    event.target.value='';
  });

  $('filters').hidden=false; $('quick-filters').hidden=false; $('tracker-toolbar').hidden=false;
  $('filter-foot').hidden=false; $('reset-empty').hidden=false; $('document-library').hidden=false;
  account = new ApplicationAccount({
    records, documentTypes,
    snapshot: () => ({ version: 3, progress, library }),
    restore: restoreState,
    apply: state => {
      progress = cleanProgress(state.progress); library = cleanLibrary(state.library);
      syncLibrary(); records.forEach(syncCard);
      $('saved-count').textContent=records.filter(r=>getProgress(r.id).saved).length;
      render();
    },
    access: (hasData, connected) => {
      document.querySelectorAll('[data-private-gate]').forEach(element => { element.hidden=hasData; });
      document.querySelectorAll('[data-private-fields]').forEach(element => { element.hidden=!hasData; element.disabled=!connected; });
      syncLibrary();
    }
  });
  account.render();
  $('nav-login').addEventListener('click', event => {
    if (account.offline) return;
    event.preventDefault();
    account.login();
  });
  $('save-status').textContent=account.offline?'Offline research copy. Open the live website for private uploads and progress.':'Sign in to manage your files and progress privately in Google Drive.';
  $('saved-count').textContent=records.filter(r=>getProgress(r.id).saved).length;
  render(); revealHash();
})();
