(() => {
  'use strict';
  const $ = id => document.getElementById(id), M = ApplicationModel;
  const data = JSON.parse($('database-data').textContent), records = data.records;
  const known = new Map(records.map(record => [record.id, record]));
  const rows = new Map(), selectedSlots = new Map(), blobUrls = new Set();
  let versionTarget = null;
  let progress = Object.create(null), library = M.cleanLibrary(null), account;
  let visible = [], limit = 12, monthFilter = '', uploadTarget = null, downloading = false, signedInView = false;
  const pFor = id => progress[id] || M.defaults();
  const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const stageOptions = () => M.stages.map(stage => `<option>${h(stage)}</option>`).join('');
  const docOptions = () => M.documentTypes.map(([key, label]) => `<option value="${key}">${h(label)}</option>`).join('');
  const shortType = record => record.collections.length > 1 ? 'Art + master’s' : record.collections[0] === 'art' ? 'Art application' : 'Master’s application';
  const effectiveFile = (id, key) => {
    const shared = { id: library.files[key] || '', url: library.documents[key] || '', shared: id !== 'library' };
    if (id === 'library') return shared;
    const doc = M.documentValue(pFor(id), key);
    return doc.file_id || doc.url ? { id: doc.file_id || '', url: doc.file_id ? '' : doc.url, shared: false } : shared;
  };
  const effectiveUrl = (id, key) => effectiveFile(id, key).url;
  const versionsFor = (id, key) => [...(account?.workspace.files.values() || [])].filter(file => file.record_id === id && file.slot === key);
  const pendingApplication = p => M.active(p) && !['Submitted', 'Offer received'].includes(p.stage);
  function setLink(element, url) {
    element.hidden = !url;
    if (url) element.href = url; else element.removeAttribute('href');
  }
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    blobUrls.add(url);
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); blobUrls.delete(url); }, 5000);
  }
  function mutate(id, values) {
    if (!account.require()) return;
    progress[id] = { ...pFor(id), ...values, saved: true };
    syncRow(known.get(id)); renderOverview(); account.changed();
    if (Object.keys(values).some(key => !['notes', 'deadline_note'].includes(key))) renderList();
  }
  function mutateDocument(id, key, values) {
    const p = pFor(id);
    mutate(id, { documents: { ...p.documents, [key]: { ...M.documentValue(p, key), ...values } } });
  }
  function saveLink(input, apply) {
    if (!account.require()) return;
    const raw = input.value.trim(), url = M.driveUrl(raw);
    if (raw && !url) { input.setCustomValidity('Use an HTTPS Google Drive or Google Docs link.'); input.reportValidity(); return; }
    input.setCustomValidity(''); input.value = url; apply(url);
  }
  function rowFor(record) {
    if (rows.has(record.id)) return rows.get(record.id);
    const id = record.id, row = document.createElement('article');
    row.className = 'application-record'; row.id = 'application-' + id;
    row.innerHTML = `<div class="record-summary"><div class="record-programme"><p class="record-category">${h(shortType(record))} · ${h(record.country)}</p><h3><a href="${h(record.catalogue_url)}" target="_blank" rel="noopener noreferrer">${h(record.programme)}</a></h3><p class="record-university">${h(record.university)}</p><div class="record-stage"><label class="sr-only" for="stage-${id}">Stage for ${h(record.programme)}</label><select id="stage-${id}" data-stage>${stageOptions()}</select><button class="text-button" type="button" data-track>+ Track</button></div></div>
      <div class="record-deadline"><span class="mobile-label">Deadline</span><strong data-date></strong><span data-day-count></span><span class="date-tag" data-date-basis></span><small data-time></small></div>
      <div class="record-progress"><span class="mobile-label">Document progress</span><div class="progress-caption"><strong data-percent>—</strong><span data-count></span></div><progress data-readiness max="100" value="0" aria-label="Document readiness for ${h(record.programme)}"></progress><p data-progress-note></p></div>
      <div class="record-actions"><label for="slot-${id}">Document to upload / retrieve</label><select id="slot-${id}" data-upload-slot>${docOptions()}</select><div class="file-buttons"><button class="button upload-button" type="button" data-upload-start>Upload ↑</button><button class="button" type="button" data-download disabled>Download ↓</button></div><button class="text-button" type="button" data-versions>Versions</button><a data-open-file target="_blank" rel="noopener noreferrer" hidden>Open existing Drive file ↗</a></div></div>
      <details class="record-details personal-progress"><summary>Manage documents, notes &amp; deadline <span data-details-count></span></summary><p class="private-gate" data-private-gate><button class="button" type="button" data-row-login>Sign in to manage this application</button></p><fieldset data-private-fields disabled hidden><legend class="sr-only">${h(record.programme)} workspace</legend><div class="record-management"><section class="record-documents"><h4>Application documents</h4><p class="management-help">Adjust this working checklist to the university’s requirements. Uploads belong to this programme and document type; earlier versions stay in the private workspace.</p><div data-document-fields></div></section><section class="record-planning"><h4>Deadline &amp; planning</h4><p class="management-help">${h(record.window)}</p><label for="deadline-${id}">Your deadline override<input id="deadline-${id}" type="date" data-deadline min="2000-01-01" max="2100-12-31"></label><label class="check-label" for="confirmed-${id}"><input type="checkbox" id="confirmed-${id}" data-deadline-confirmed> I verified this date with the university</label><label for="date-note-${id}">Deadline source / closing time<textarea id="date-note-${id}" data-deadline-note maxlength="4000" rows="2" placeholder="Official link, local closing time, or admissions confirmation…"></textarea></label><button class="text-button" type="button" data-reset-deadline>Use research date</button><label for="notes-${id}">My notes<textarea id="notes-${id}" data-notes maxlength="4000" rows="4" placeholder="Eligibility checks, next steps, admissions response…"></textarea></label><label for="folder-${id}">Existing Drive folder (optional)<input id="folder-${id}" type="url" data-folder maxlength="2048" autocomplete="off" placeholder="https://drive.google.com/…"></label><a data-open-folder target="_blank" rel="noopener noreferrer" hidden>Open existing Drive folder ↗</a><div class="application-requirements"><h4>Requirements to check</h4><p>${h(record.fit)}</p><p>${h(record.art_requirements || record.requirements)}</p><a href="${h(record.application_url)}" target="_blank" rel="noopener noreferrer">University admissions ↗</a></div></section></div></fieldset></details>`;
    row.querySelector('[data-track]').addEventListener('click', () => mutate(id, { saved: true }));
    row.querySelector('[data-stage]').addEventListener('change', event => mutate(id, { stage: event.target.value }));
    row.querySelector('[data-upload-slot]').addEventListener('change', event => { selectedSlots.set(id, event.target.value); syncRow(record); });
    row.querySelector('[data-upload-start]').addEventListener('click', () => chooseUpload(id, selectedSlots.get(id) || 'cv'));
    row.querySelector('[data-download]').addEventListener('click', () => retrieve(id, selectedSlots.get(id) || 'cv'));
    row.querySelector('[data-versions]').addEventListener('click', () => showVersions(id, selectedSlots.get(id) || 'cv'));
    row.querySelector('[data-row-login]').addEventListener('click', () => account.login());
    row.querySelector('details').addEventListener('toggle', event => { if (event.target.open) initialiseDocuments(record, row); });
    row.querySelector('[data-notes]').addEventListener('input', event => mutate(id, { notes: event.target.value.slice(0, 4000) }));
    row.querySelector('[data-deadline]').addEventListener('change', event => {
      if (!event.target.validity.valid) { event.target.reportValidity(); return; }
      mutate(id, { deadline: event.target.value, deadline_confirmed: false });
    });
    row.querySelector('[data-deadline-confirmed]').addEventListener('change', event => mutate(id, { deadline_confirmed: event.target.checked }));
    row.querySelector('[data-deadline-note]').addEventListener('input', event => mutate(id, { deadline_note: event.target.value.slice(0, 4000) }));
    row.querySelector('[data-reset-deadline]').addEventListener('click', () => mutate(id, { deadline: '', deadline_note: '', deadline_confirmed: false }));
    const folder = row.querySelector('[data-folder]');
    folder.addEventListener('input', () => folder.setCustomValidity(''));
    folder.addEventListener('change', () => saveLink(folder, url => mutate(id, { folder: url })));
    rows.set(id, row); syncRow(record); return row;
  }
  function initialiseDocuments(record, row) {
    const container = row.querySelector('[data-document-fields]');
    if (container.childElementCount) return;
    for (const [key, label] of M.documentTypes) {
      const item = document.createElement('div'); item.className = 'document-slot'; item.dataset.documentRow = key;
      const prefix = record.id + '-' + key;
      item.innerHTML = `<div class="slot-heading"><label for="status-${prefix}">${h(label)}</label><span class="slot-state" data-slot-state></span></div><div class="slot-controls"><select id="status-${prefix}" data-document-status>${M.documentStages.map(s => `<option>${h(s)}</option>`).join('')}</select><button class="button upload-button" data-document-upload type="button">Upload ↑</button><button class="button" data-document-download type="button" disabled>Download ↓</button></div><div class="slot-file"><span data-file-origin>No file attached</span><button class="text-button" type="button" data-document-versions>Versions</button><a data-document-open target="_blank" rel="noopener noreferrer" hidden>Open in Drive ↗</a></div><details class="manual-link"><summary>Use an existing Drive link</summary><label for="link-${prefix}" class="sr-only">${h(label)} Drive link</label><input id="link-${prefix}" data-document-url type="url" maxlength="2048" autocomplete="off" placeholder="https://drive.google.com/…"></details>`;
      item.querySelector('[data-document-status]').addEventListener('change', event => mutateDocument(record.id, key, { status: event.target.value }));
      item.querySelector('[data-document-upload]').addEventListener('click', () => chooseUpload(record.id, key));
      item.querySelector('[data-document-download]').addEventListener('click', () => retrieve(record.id, key));
      item.querySelector('[data-document-versions]').addEventListener('click', () => showVersions(record.id, key));
      const input = item.querySelector('[data-document-url]');
      input.addEventListener('input', () => input.setCustomValidity(''));
      input.addEventListener('change', () => saveLink(input, url => mutateDocument(record.id, key, { url, file_id: '' })));
      container.append(item);
    }
    syncRow(record);
  }
  function syncRow(record) {
    const row = rows.get(record.id); if (!row) return;
    const p = pFor(record.id), ready = M.readiness(p, library), due = M.deadline(record, p);
    const has = !!account?.hasData, connected = has && account.workspace.connected, editable = connected && account.workspace.canEdit;
    row.dataset.tracked = String(has && M.tracked(p));
    row.querySelector('[data-track]').hidden = has && M.tracked(p);
    row.querySelector('[data-track]').disabled = has && !editable;
    row.querySelector('[data-stage]').value = p.stage; row.querySelector('[data-stage]').disabled = !editable;
    row.querySelector('[data-date]').textContent = M.formatDate(due.date);
    row.querySelector('[data-day-count]').textContent = due.days === null ? 'Check the next application cycle' : due.days < 0 ? `${-due.days} days past` : due.days === 0 ? 'Due today · check closing time' : `In ${due.days} days`;
    row.querySelector('[data-date-basis]').textContent = due.basis; row.querySelector('[data-date-basis]').dataset.confirmed = String(due.confirmed);
    row.querySelector('[data-time]').textContent = due.time;
    row.querySelector('[data-percent]').textContent = has ? ready.required ? ready.percent + '%' : '—' : '—';
    row.querySelector('[data-count]').textContent = has ? ready.required ? `${ready.ready} / ${ready.required} ready` : 'No required slots' : 'Sign in to load';
    const meter = row.querySelector('[data-readiness]'); meter.value = has ? ready.percent : 0;
    meter.setAttribute('aria-valuetext', has ? `${ready.ready} of ${ready.required} documents marked ready` : 'Sign in to load your progress');
    row.querySelector('[data-progress-note]').textContent = has ? `${ready.linked} linked file${ready.linked === 1 ? '' : 's'}${ready.draft ? ' · ' + ready.draft + ' in draft' : ''}` : 'Your private checklist';
    row.querySelector('[data-details-count]').textContent = has && M.tracked(p) ? p.stage : '';
    const slot = selectedSlots.get(record.id) || 'cv', ref = has ? effectiveFile(record.id, slot) : { id: '', url: '' }, url = ref.url;
    row.querySelector('[data-upload-slot]').value = slot;
    row.querySelector('[data-download]').disabled = !connected || !ref.id || downloading;
    row.querySelector('[data-download]').title = ref.id ? 'Download the selected private document' : url ? 'Use the existing Drive link to retrieve this file' : 'Upload this document first';
    const versions = versionsFor(record.id, slot);
    row.querySelector('[data-versions]').textContent = 'Versions (' + versions.length + ')';
    row.querySelector('[data-versions]').disabled = !connected || !versions.length;
    row.querySelector('[data-upload-start]').disabled = !!account?.uploading || (has && !editable);
    setLink(row.querySelector('[data-open-file]'), url);
    row.querySelector('[data-private-gate]').hidden = has;
    row.querySelector('[data-private-fields]').hidden = !has; row.querySelector('[data-private-fields]').disabled = !connected;
    for (const [selector, value] of [['[data-notes]', p.notes], ['[data-deadline]', p.deadline], ['[data-deadline-note]', p.deadline_note], ['[data-folder]', p.folder]]) {
      const field = row.querySelector(selector); if (field.value !== value) field.value = value; field.disabled = !editable;
    }
    row.querySelector('[data-deadline-confirmed]').checked = p.deadline_confirmed;
    row.querySelector('[data-deadline-confirmed]').disabled = !editable || !p.deadline;
    row.querySelector('[data-reset-deadline]').disabled = !editable;
    setLink(row.querySelector('[data-open-folder]'), has ? p.folder : '');
    row.querySelectorAll('[data-document-row]').forEach(item => {
      const key = item.dataset.documentRow, doc = M.documentValue(p, key), ref = effectiveFile(record.id, key), file = account?.workspace.files.get(ref.id);
      item.querySelector('[data-document-status]').disabled = !editable;
      item.querySelector('[data-document-url]').disabled = !editable;
      item.querySelector('[data-document-status]').value = doc.status;
      item.querySelector('[data-document-url]').value = doc.url;
      item.querySelector('[data-slot-state]').textContent = doc.status; item.querySelector('[data-slot-state]').dataset.state = doc.status;
      item.querySelector('[data-file-origin]').textContent = file ? (ref.shared ? 'Shared: ' : '') + file.filename : ref.url ? 'Existing Drive reference' : 'No file attached';
      const count = versionsFor(record.id, key).length;
      item.querySelector('[data-document-versions]').textContent = 'Versions (' + count + ')';
      item.querySelector('[data-document-versions]').disabled = !connected || !count;
      item.querySelector('[data-document-download]').disabled = !connected || !ref.id || downloading;
      item.querySelector('[data-document-upload]').disabled = !editable || !!account?.uploading;
      setLink(item.querySelector('[data-document-open]'), has ? ref.url : '');
    });
  }
  function syncLibrary() {
    const has = !!account?.hasData, connected = has && account.workspace.connected, editable = connected && account.workspace.canEdit;
    $('drive-folder').value = library.folder; $('drive-folder').disabled = !editable;
    setLink($('drive-upload'), has ? library.folder : '');
    for (const [key] of M.documentTypes) {
      const item = document.querySelector(`[data-resource="${key}"]`), url = has ? library.documents[key] : '', file = has ? account.workspace.files.get(library.files[key]) : null;
      item.querySelector('input').value = url || ''; item.querySelector('input').disabled = !editable;
      item.querySelector('[data-resource-state]').textContent = file ? file.filename : url ? 'Existing Drive reference' : 'No file attached';
      item.querySelector('[data-library-download]').disabled = !connected || !file || downloading;
      item.querySelector('[data-library-upload]').textContent = file || url ? 'Upload version ↑' : 'Upload ↑';
      item.querySelector('[data-library-upload]').disabled = !editable || !!account?.uploading;
      const count = versionsFor('library', key).length;
      item.querySelector('[data-library-versions]').textContent = 'Versions (' + count + ')';
      item.querySelector('[data-library-versions]').disabled = !connected || !count;
      setLink(item.querySelector('[data-library-open]'), url);
    }
  }
  function renderOverview() {
    const has = !!account?.hasData;
    const tracked = has ? records.filter(r => M.tracked(pFor(r.id))) : [];
    const active = tracked.filter(r => M.active(pFor(r.id)));
    const pending = tracked.filter(r => pendingApplication(pFor(r.id)));
    const dueSoon = pending.filter(r => { const d = M.deadline(r, pFor(r.id)); return d.days !== null && d.days >= 0 && d.days <= 30; });
    const submitted = tracked.filter(r => ['Submitted','Offer received'].includes(pFor(r.id).stage));
    $('stat-tracked').textContent = has ? tracked.length : '—'; $('stat-preparing').textContent = has ? pending.length : '—';
    $('stat-soon').textContent = has ? dueSoon.length : '—'; $('stat-submitted').textContent = has ? submitted.length : '—';
    const artCount = tracked.filter(r => r.collections.includes('art')).length, masterCount = tracked.filter(r => r.collections.includes('masters')).length;
    $('stat-types').textContent = has ? `${artCount} art · ${masterCount} master’s · overlaps counted once above` : 'Art and master’s, together';
    const planning = dueSoon.filter(r => !M.deadline(r, pFor(r.id)).confirmed).length;
    $('stat-soon-detail').textContent = has ? `${planning} planning date${planning === 1 ? '' : 's'} to verify` : 'Planning dates stay labelled';
    $('stat-offers').textContent = has ? `${tracked.filter(r => pFor(r.id).stage === 'Offer received').length} offers received` : 'Waiting for your next step';
    $('overview-context').textContent = has ? `Shared workspace · ${M.formatDate(M.today())}` : 'Sign in to see your actual progress.';
    const sum = active.reduce((total, r) => { const x = M.readiness(pFor(r.id), library); total.ready += x.ready; total.required += x.required; return total; }, { ready: 0, required: 0 });
    const percent = sum.required ? Math.round(sum.ready / sum.required * 100) : 0;
    $('overall-percent').textContent = has && sum.required ? percent + '%' : '—';
    $('overall-fraction').textContent = has ? `${sum.ready} / ${sum.required} marked ready` : 'No account connected';
    $('readiness-ring').style.setProperty('--readiness', percent + '%');
    $('readiness-ring').setAttribute('aria-label', has ? `${sum.ready} of ${sum.required} documents marked ready across active applications` : 'Sign in to load document readiness');
    $('overall-copy').textContent = has ? active.length ? `${active.length} active applications. Every ready document brings the next submission closer.` : 'Track a programme below to start your checklist.' : 'Your active applications will appear here after sign-in.';
    $('type-progress').replaceChildren();
    for (const [key, label] of [['art','Art applications'],['masters','Master’s applications']]) {
      const matching = active.filter(r => r.collections.includes(key));
      const counts = matching.reduce((x,r) => { const ready=M.readiness(pFor(r.id),library);x.ready+=ready.ready;x.required+=ready.required;return x; }, {ready:0,required:0});
      const group=document.createElement('div');
      group.innerHTML=`<span>${label}</span><small>${has ? counts.ready+' / '+counts.required+' ready' : '—'}</small><progress max="100" value="${counts.required ? Math.round(100*counts.ready/counts.required) : 0}" aria-label="${label} document readiness"></progress>`;
      $('type-progress').append(group);
    }
    renderTimeline(pending,has);
    $('stage-pipeline').replaceChildren();
    for (const stage of M.stages) {
      const button=document.createElement('button');button.type='button';button.className='pipeline-stage';
      const count=tracked.filter(r=>pFor(r.id).stage===stage).length;
      button.innerHTML=`<span>${h(stage)}</span><strong>${has ? count : '—'}</strong>`;
      button.setAttribute('aria-pressed',String($('db-stage').value===stage&&$('db-view').value==='tracked'));
      button.addEventListener('click',()=>{ $('database-filters').reset();$('db-view').value='tracked';$('db-stage').value=stage;monthFilter='';limit=12;renderList();renderOverview();$('application-tracker').scrollIntoView({behavior:'smooth'}); });
      $('stage-pipeline').append(button);
    }
  }
  function renderTimeline(pending,has) {
    const today=M.today(),monthDate=new Date(today.slice(0,7)+'-01T12:00:00Z');
    const months=Array.from({length:6},(_,offset)=>{
      const date=new Date(monthDate);date.setUTCMonth(date.getUTCMonth()+offset);
      const key=date.toISOString().slice(0,7), matching=pending.filter(r=>M.deadline(r,pFor(r.id)).date.startsWith(key));
      const confirmed=matching.filter(r=>M.deadline(r,pFor(r.id)).confirmed).length;
      return {key,date,confirmed,planning:matching.length-confirmed};
    });
    const max=Math.max(1,...months.map(m=>m.confirmed+m.planning));$('deadline-chart').replaceChildren();
    for(const month of months){
      const button=document.createElement('button');button.className='month-column';button.type='button';
      const label=new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'}).format(month.date);
      button.setAttribute('aria-label',`${label} ${month.date.getUTCFullYear()}: ${has ? month.confirmed+' confirmed and '+month.planning+' planning deadlines' : 'sign in to load deadlines'}`);
      button.setAttribute('aria-pressed',String(monthFilter===month.key));
      button.innerHTML=`<span class="month-count">${has ? month.confirmed+month.planning : '—'}</span><span class="month-bars"><span class="month-confirmed" style="height:${month.confirmed/max*100}%"></span><span class="month-planning" style="height:${month.planning/max*100}%"></span></span><span class="month-label">${label}<small>${month.date.getUTCFullYear()}</small></span>`;
      button.addEventListener('click',()=>{const next=monthFilter===month.key?'':month.key;$('database-filters').reset();monthFilter=next;$('db-view').value='active';$('db-stage').value='pending-group';limit=12;renderList();renderOverview();$('application-tracker').scrollIntoView({behavior:'smooth'});});
      $('deadline-chart').append(button);
    }
    const past=pending.filter(r=>M.deadline(r,pFor(r.id)).days!==null&&M.deadline(r,pFor(r.id)).days<0).length;
    const unknown=pending.filter(r=>!M.deadline(r,pFor(r.id)).date).length;
    const later=pending.filter(r=>M.deadline(r,pFor(r.id)).date.slice(0,7)>months.at(-1).key).length;
    $('overdue-count').textContent=has?past:'—';$('undated-count').textContent=has?unknown:'—';
    $('deadline-chart-note').textContent=has?`Click a month to filter. ${later} later deadlines; submitted and closed applications are excluded.`:'Sign in to chart deadlines for the applications you track.';
    $('clear-timeline').hidden=!monthFilter;
  }
  function updateCount(){
    $('database-count').textContent=`${visible.length} matching programmes · ${Math.min(limit,visible.length)} shown`;
  }
  function renderList() {
    const query=$('db-search').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean), view=$('db-view').value, collection=$('db-collection').value, stage=$('db-stage').value, deadlineFilter=$('db-deadline').value;
    visible=records.filter(r=>{
      const p=pFor(r.id),due=M.deadline(r,p);
      if(view==='tracked'&&(!account?.hasData||!M.tracked(p)))return false;
      if(view==='active'&&(!account?.hasData||!M.active(p)))return false;
      if(collection&&!r.collections.includes(collection))return false;
      if(stage&&(!account?.hasData||(stage==='pending-group'?!pendingApplication(p):stage==='submitted-group'?!['Submitted','Offer received'].includes(p.stage):p.stage!==stage)))return false;
      if(monthFilter&&!due.date.startsWith(monthFilter))return false;
      if(monthFilter&&['Submitted','Offer received'].includes(p.stage))return false;
      if(deadlineFilter==='soon'&&!(due.days!==null&&due.days>=0&&due.days<=30))return false;
      if(deadlineFilter==='quarter'&&!(due.days!==null&&due.days>=0&&due.days<=90))return false;
      if(deadlineFilter==='past'&&!(due.days!==null&&due.days<0))return false;
      if(deadlineFilter==='unknown'&&due.date)return false;
      const text=[r.programme,r.university,r.city,r.country,r.field].join(' ').toLocaleLowerCase();return query.every(word=>text.includes(word));
    });
    visible.sort((a,b)=>{
      if($('db-sort').value==='university')return a.university.localeCompare(b.university)||a.programme.localeCompare(b.programme);
      if($('db-sort').value==='remaining'){const x=M.readiness(pFor(a.id)),y=M.readiness(pFor(b.id));return (y.required-y.ready)-(x.required-x.ready)||a.university.localeCompare(b.university);}
      const x=M.deadline(a,pFor(a.id)),y=M.deadline(b,pFor(b.id));
      const group=due=>due.days===null?2:due.days<0?1:0;
      return group(x)-group(y)||(group(x)===1?y.date.localeCompare(x.date):x.date.localeCompare(y.date))||a.university.localeCompare(b.university);
    });
    const focus=document.activeElement,selection=focus?.selectionStart!==undefined?[focus.selectionStart,focus.selectionEnd]:null;
    const fragment=document.createDocumentFragment();
    visible.slice(0,limit).forEach(r=>{const row=rowFor(r);syncRow(r);fragment.append(row);});
    $('database-list').replaceChildren(fragment);
    if(focus?.isConnected&&focus.closest('#database-list')){focus.focus({preventScroll:true});if(selection)try{focus.setSelectionRange(...selection);}catch{/* Select and date controls have no text selection. */}}
    $('database-empty').hidden=visible.length!==0;
    $('empty-detail').textContent=!account?.hasData&&view!=='all'?'Sign in to load your tracked applications. The public programme index is available without sign-in.':'Track programmes from the full index, or clear filters to see more applications.';
    $('database-more').hidden=visible.length<=limit;
    $('month-filter-label').hidden=!monthFilter;$('month-filter-label').textContent=monthFilter?'Deadline month: '+monthFilter:'';
    updateCount();
  }
  function renderAll() { syncLibrary(); rows.forEach((row,id)=>syncRow(known.get(id)));renderOverview();renderList(); if ($('versions-dialog').open) renderVersions(); }
  function chooseUpload(id,key) {
    if(!account.require())return;
    if(account.uploading){account.status('Finish or cancel the current upload first.');return;}
    uploadTarget={id,key,name:id==='library'?'Shared documents':known.get(id).university+' — '+known.get(id).programme,epoch:account.epoch};
    $('document-file').value='';$('document-file').click();
  }
  $('document-file').addEventListener('change',event=>{
    const file=event.target.files[0],target=uploadTarget;uploadTarget=null;event.target.value='';
    if(!file||!target||target.epoch!==account.epoch)return;
    account.upload(file,target);
  });
  async function retrieve(id,key){
    if(!account.require(false))return;
    const ref=effectiveFile(id,key);if(ref.id)await downloadFile(ref.id);
  }
  async function downloadFile(id){
    if(!account.require(false)||downloading)return;
    const epoch=account.epoch;downloading=true;account.status('Retrieving your private document…');renderAll();
    try{const file=await account.workspace.download(id);if(epoch!==account.epoch)return;downloadBlob(file.name,file.blob);account.status(file.name+' downloaded. The original remains in the workspace.');}
    catch(error){if(epoch===account.epoch&&error.name!=='AbortError'&&!account.denied(error))account.status('Download unavailable. '+error.message);}
    finally{if(epoch===account.epoch){downloading=false;renderAll();}}
  }
  function showVersions(id,key){
    if(!account.require(false))return;
    versionTarget={id,key};$('versions-message').textContent='';renderVersions();
    if(!$('versions-dialog').open)$('versions-dialog').showModal();
  }
  function renderVersions(){
    if(!versionTarget||!account?.hasData)return;
    const {id,key}=versionTarget,files=versionsFor(id,key),current=id==='library'?library.files[key]:M.documentValue(pFor(id),key).file_id;
    $('versions-title').textContent=M.documentTypes.find(type=>type[0]===key)[1]+' versions';
    $('versions-context').textContent=id==='library'?'Shared resources':known.get(id).programme+' · '+known.get(id).university;
    $('versions-list').replaceChildren();
    for(const file of files){
      const row=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('p');
      name.textContent=file.filename+(file.id===current?' · Current':'');
      detail.textContent=file.actor_name+(file.actor_kind==='agent'?' · Agent':'')+' · '+new Date(file.completed_at).toLocaleString('en-GB')+' · '+(file.size_bytes/1024).toFixed(1)+' KB';
      row.append(name,detail);
      const download=document.createElement('button');download.className='button';download.type='button';download.textContent='Download';download.disabled=downloading;
      download.addEventListener('click',()=>downloadFile(file.id));row.append(download);
      if(file.id!==current&&account.workspace.canEdit){
        const use=document.createElement('button');use.className='button';use.type='button';use.textContent='Use this version';
        use.addEventListener('click',()=>{
          if(!account.require())return;
          if(id==='library'){library.files[key]=file.id;library.documents[key]='';account.changed();renderAll();}
          else mutateDocument(id,key,{file_id:file.id,url:''});
          renderVersions();$('versions-message').textContent='Selected this version. Saving the updated file reference…';
        });row.append(use);
      }
      $('versions-list').append(row);
    }
  }
  $('close-versions').addEventListener('click',()=>$('versions-dialog').close());
  $('versions-dialog').addEventListener('close',()=>{versionTarget=null;$('versions-list').replaceChildren();$('versions-context').textContent='';$('versions-message').textContent='';$('versions-title').textContent='File versions.';});
  $('drive-folder').addEventListener('input',e=>e.target.setCustomValidity(''));
  $('drive-folder').addEventListener('change',e=>saveLink(e.target,url=>{library.folder=url;account.changed();}));
  for(const [key] of M.documentTypes){
    document.querySelector(`[data-library-upload="${key}"]`).addEventListener('click',()=>chooseUpload('library',key));
    document.querySelector(`[data-library-download="${key}"]`).addEventListener('click',()=>retrieve('library',key));
    document.querySelector(`[data-library-versions="${key}"]`).addEventListener('click',()=>showVersions('library',key));
    const input=$('library-'+key);input.addEventListener('input',()=>input.setCustomValidity(''));
    input.addEventListener('change',()=>saveLink(input,url=>{library.documents[key]=url;library.files[key]='';account.changed();renderAll();}));
  }
  function restoreState(parsed){
    if(!parsed||![1,2,3,4].includes(parsed.version))throw new Error('This is not a supported application-progress backup.');
    if(parsed.version===4&&parsed.workspace_id!==account.workspace.config.workspaceId)throw new Error('This backup belongs to a different workspace. Its private file references cannot be restored here.');
    const restored=M.cleanProgress(parsed.progress,known),restoredLibrary=parsed.version>=2&&parsed.library?M.cleanLibrary(parsed.library):null;
    const checkFile=(id,key,fileId)=>{if(!fileId)return;const file=account.workspace.files.get(fileId);if(!file||file.record_id!==id||file.slot!==key)throw new Error('A backup file reference is unavailable in this workspace. Sync before restoring.');};
    for(const[id,p]of Object.entries(restored))for(const[key]of M.documentTypes)checkFile(id,key,p.documents[key]?.file_id);
    if(restoredLibrary)for(const[key]of M.documentTypes)checkFile('library',key,restoredLibrary.files[key]);
    if(!Object.keys(restored).length&&!restoredLibrary)throw new Error('No matching applications were found in this backup.');
    for(const[id,p]of Object.entries(restored))progress[id]=parsed.version===1?{...pFor(id),saved:p.saved,stage:p.stage,notes:p.notes}:p;
    if(restoredLibrary)library=restoredLibrary;
    renderAll();return Object.keys(restored).length;
  }
  $('backup-progress').addEventListener('click',()=>{
    if(!account.hasData)return;
    downloadBlob('ecosapien-application-progress.json',new Blob([JSON.stringify({version:4,workspace_id:account.workspace.config.workspaceId,exported_at:new Date().toISOString(),progress,library},null,2)],{type:'application/json'}));
    account.status('Private progress backup downloaded. It contains notes and file links, not the document files.');
  });
  $('restore-progress').addEventListener('click',()=>{if(account.require())$('backup-file').click();});
  $('backup-file').addEventListener('change',async event=>{
    const file=event.target.files[0],epoch=account.epoch;if(!file||!account.require())return;
    try{if(file.size>6*1024*1024)throw new Error('Choose a progress JSON file smaller than 6 MB.');const parsed=JSON.parse(await file.text());
      if(epoch!==account.epoch||!account.hasData)return;
      if(!confirm('Restore this backup into the shared workspace? All members will see it. Matching application entries will be replaced; other entries remain.'))return;
      const count=restoreState(parsed);account.changed();account.status(`Restored ${count} application entries. Saving to the shared workspace…`);
    }catch(error){if(epoch===account.epoch)account.status(error.message||'The backup could not be restored.');}finally{event.target.value='';}
  });
  $('export-csv').addEventListener('click',()=>{
    const headers=['Programme','University','Lists','Country','Deadline','Deadline evidence','Application window','Tracked','Stage','Documents ready','Documents required','Readiness percent','Application folder','Notes','Deadline note'];
    for(const[,label]of M.documentTypes)headers.push(label+' status',label+' existing Drive link',label+' private file ID');
    const csv=[headers.map(M.csvCell).join(',')];
    for(const record of visible){const p=pFor(record.id),ready=M.readiness(p,library),due=M.deadline(record,p);const cells=[record.programme,record.university,shortType(record),record.country,due.date,due.basis,record.window,account.hasData?M.tracked(p)?'Yes':'No':'',account.hasData?p.stage:'',account.hasData?ready.ready:'',account.hasData?ready.required:'',account.hasData?ready.percent:'',p.folder,p.notes,p.deadline_note];
      for(const[key]of M.documentTypes){const doc=M.documentValue(p,key);cells.push(account.hasData?doc.status:'',effectiveUrl(record.id,key),account.hasData?effectiveFile(record.id,key).id:'');}csv.push(cells.map(M.csvCell).join(','));}
    downloadBlob('ecosapien-applications-dashboard.csv',new Blob(['\uFEFF'+csv.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}));
    account.status(`Exported ${visible.length} matching programmes.`+(account.hasData?' Keep this download private; it includes your notes and document links.':''));
  });
  function resetFilters(){ $('database-filters').reset();monthFilter='';limit=12;renderList();renderOverview(); }
  ['db-search','db-view','db-collection','db-stage','db-deadline','db-sort'].forEach(id=>$(id).addEventListener(id==='db-search'?'input':'change',()=>{limit=12;if(id==='db-deadline')monthFilter='';renderList();renderOverview();}));
  $('database-filters').addEventListener('submit',event=>event.preventDefault());
  $('database-filters').addEventListener('reset',()=>{monthFilter='';limit=12;setTimeout(()=>{renderList();renderOverview();},0);});
  $('browse-programmes').addEventListener('click',resetFilters);
  $('more-applications').addEventListener('click',()=>{limit+=12;renderList();});
  $('clear-timeline').addEventListener('click',()=>{monthFilter='';renderList();renderOverview();});
  function filterOverview(mode){
    $('database-filters').reset();monthFilter='';limit=12;$('db-view').value=mode==='tracked'||mode==='submitted'?'tracked':'active';
    if(mode==='soon')$('db-deadline').value='soon';
    if(['preparing','soon','active'].includes(mode))$('db-stage').value='pending-group';
    if(mode==='submitted')$('db-stage').value='submitted-group';
    renderList();renderOverview();$('application-tracker').scrollIntoView({behavior:'smooth'});
  }
  document.querySelectorAll('[data-overview-filter]').forEach(button=>button.addEventListener('click',()=>filterOverview(button.dataset.overviewFilter)));
  $('show-overdue').addEventListener('click',()=>{filterOverview('active');$('db-deadline').value='past';renderList();});
  $('show-undated').addEventListener('click',()=>{filterOverview('active');$('db-deadline').value='unknown';renderList();});
  function revealHash(){
    if(location.hash==='#login'){account.login();return;}
    const id=location.hash.replace(/^#application-/,'');if(!known.has(id))return;
    $('database-filters').reset();monthFilter='';$('db-search').value=known.get(id).programme;limit=records.length;renderList();
    const row=rowFor(known.get(id));row.querySelector('details').open=true;initialiseDocuments(known.get(id),row);
    requestAnimationFrame(()=>row.scrollIntoView({block:'center'}));
  }
  account=new ApplicationAccount({records,documentTypes:M.documentTypes,snapshot:()=>({version:4,progress,library}),restore:restoreState,
    apply:state=>{progress=M.cleanProgress(state.progress,known);library=M.cleanLibrary(state.library);
      if(account?.hasData&&!signedInView){signedInView=true;if(records.some(r=>M.tracked(pFor(r.id)))&&!location.hash.startsWith('#application-'))$('db-view').value='tracked';}
      renderAll();},
    access:(has,connected,editable)=>{
      document.querySelectorAll('[data-private-gate]').forEach(element=>{element.hidden=has;});
      document.querySelectorAll('[data-private-fields]').forEach(element=>{element.hidden=!has;element.disabled=!connected;});
      if(!has){$('versions-dialog').close();versionTarget=null;$('versions-list').replaceChildren();$('versions-context').textContent='';$('versions-message').textContent='';$('versions-title').textContent='File versions.';blobUrls.forEach(url=>URL.revokeObjectURL(url));blobUrls.clear();signedInView=false;downloading=false;uploadTarget=null;document.querySelectorAll('input[type="url"]').forEach(input=>input.setCustomValidity(''));}
      renderAll();
    }
  });
  account.render();renderAll();revealHash();window.addEventListener('hashchange',revealHash);
})();
