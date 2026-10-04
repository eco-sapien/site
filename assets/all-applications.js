(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const data = JSON.parse($('application-data').textContent), records = data.records;
  const known = new Map(records.map(record => [record.id, record]));
  const cards = new Map(records.map(record => [record.id, $('route-' + record.id)]));
  let visible = [], limit = 12, currentPreset = 'potential', programmaticReset = false;
  const controls = ['search', 'scope', 'field', 'intake', 'english', 'tuition', 'sort'];
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
      location.replace(document.body.dataset.offline === 'true' ? 'https://www.ecosapien.de/databases.html#login' : 'databases.html#login');
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
    const columns=data.csv_columns, rows=[columns.map(c=>csvCell(c.label)).join(',')];
    visible.forEach(record=>{
      const values={...record,candidate:record.candidate?'Conditional investigation':'Known barrier / screened out',sources:record.sources.map(s=>s.url).join(' | '),shortlisted:'No',application_stage:'Not started',notes:'',application_folder:'',document_progress:''};
      rows.push(columns.map(c=>csvCell(values[c.key])).join(','));
    });
    download('all-applications-filtered.csv','\uFEFF'+rows.join('\r\n')+'\r\n','text/csv;charset=utf-8');
    $('save-status').textContent=`Exported ${visible.length} matching research routes. Personal progress is managed in Databases.`;
  });
  ['filters','quick-filters','tracker-toolbar','filter-foot','reset-empty'].forEach(id=>{$(id).hidden=false;});
  render(); revealHash();
})();
