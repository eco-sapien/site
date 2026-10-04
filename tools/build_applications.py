#!/usr/bin/env python3
"""Build the public comparison, Excel-friendly CSV and self-contained HTML.

Run from any directory: python3 tools/build_applications.py
The maintained research source is data/all-applications.json. No dependencies.
"""
import csv
import html
import io
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT/'data/all-applications.json').read_text())
ROWS = DATA['records']
E = lambda value: html.escape(str(value), quote=True)
# Keep document columns in the downloadable research CSV for compatibility.
DOCUMENT_TYPES = [('cv','CV'),('statement','Statement / essay'),('portfolio','Portfolio / proposal'),('degree','Degree certificate'),('transcript','Transcript'),('language','English evidence'),('aps','APS / qualification check'),('reference','Reference'),('employment','Work evidence')]
COLUMNS = [
    ('programme','Programme'),('university','University'),('city','City'),('field','Subject'),
    ('assessment','Assessment'),('candidate','Research category'),('fit','Fit / main barrier'),
    ('degree','Degree'),('duration','Duration'),('mode','Study format'),
    ('intake','Next intake assessed'),('deadline','Planning deadline ISO'),('date_basis','Deadline evidence'),
    ('window','Application window and stages'),('winter_note','Winter 2026/27 finding'),
    ('tuition_eur','Tuition EUR per semester'),('tuition_note','Tuition conditions'),
    ('semester_eur','Semester contribution EUR'),('semester_note','Contribution details'),
    ('extra_fees','Additional charges'),('fee_basis','Fee reference / uncertainty'),
    ('requirements','Academic / portfolio / experience requirements'),('ielts_min','Published IELTS minimum'),
    ('english','English requirement'),('german','German requirement'),
    ('application_route','Application procedure'),('programme_url','Official programme URL'),
    ('application_url','Official admissions URL'),('portal_url','Application portal URL'),
    ('evidence_level','Evidence level'),('sources','Sources'),('checked_at','Research checked'),
    ('id','Stable record ID'),('shortlisted','Shortlisted'),('application_stage','Application stage'),('notes','My notes'),
    ('application_folder','My Drive application folder'),('document_progress','My document checklist')
]
for key,label in DOCUMENT_TYPES:
    COLUMNS.extend([(key+'_status',label+' status'),(key+'_url',label+' Drive link')])
DATA['csv_columns']=[{'key':k,'label':v} for k,v in COLUMNS]
DATA['starting_ids']=['daad-11011','daad-3687','daad-9214','daad-10685','daad-10713','daad-10627','daad-4556','daad-10634','trier-gemstones']

def money(amount):
    if amount is None:return 'Check amount'
    return '€'+(f'{amount:,.0f}' if amount==int(amount) else f'{amount:,.2f}')

def link(url,label,cls=''):
    if not url:return ''
    assert url.startswith(('https://','http://')),url
    return f'<a href="{E(url)}" target="_blank" rel="noopener noreferrer"'+(f' class="{cls}"' if cls else '')+f'>{E(label)} <span aria-hidden="true">↗</span></a>'

def detail(label,value):
    return f'<div><dt>{E(label)}</dt><dd>{E(value)}</dd></div>'

def card(r):
    number=f"{r['rank']+1:02d}"
    cardid='route-'+r['id']
    deadline=date.fromisoformat(r['deadline']).strftime('%d %B %Y').lstrip('0') if r['deadline'] else 'Date to confirm'
    confirmed='true' if r['date_basis'].startswith('Published') else 'false'
    kind='start' if r['assessment']=='Start here' else 'excluded' if not r['candidate'] else 'conditional'
    body=[f'<article class="programme-card" id="{E(cardid)}" aria-labelledby="{E(cardid)}-title">',
          f'<div class="card-top"><p class="tag" data-kind="{kind}">{number} / {E(r["assessment"])}</p></div>',
          f'<h3 id="{E(cardid)}-title">{E(r["programme"])}</h3>',
          f'<p class="university">{E(r["university"])}</p><p class="location">{E(r["city"])} · {E(r["duration"])}</p>',
          f'<p class="fit-note">{E(r["fit"])}</p>',
          f'<div class="deadline-panel"><div class="deadline-heading"><strong>{E(deadline)}</strong><span class="intake-label">{E(r["intake"])}</span></div><p class="date-basis" data-confirmed="{confirmed}">{E(r["date_basis"])}</p><p class="window-text">{E(r["window"])}</p></div>',
          '<dl class="cost-grid"><div><dt>Tuition / semester</dt><dd>'+money(r['tuition_eur'])+'<span class="cost-detail">Indian / non-EU category</span></dd></div><div><dt>Semester contribution</dt><dd>'+money(r['semester_eur'])+'<span class="cost-detail">'+('Plus any extra charges below' if r['semester_eur'] is not None else 'Amount not verified')+'</span></dd></div></dl>',
          f'<p class="english-line"><strong>English · </strong>{E(r["english"])}</p>',
          '<div class="card-actions">'+link(r['application_url'],'Admissions','button primary')+link(r['portal_url'],'Application portal')+link(r['programme_url'],'Programme')+'</div>',
          '<details class="academic-details"><summary>Requirements, fees &amp; sources</summary><dl class="requirements">']
    if r['id'] in ('daad-7728','daad-4601','trier-gemstones'):
        body.insert(-1, '<p class="fee-extra"><strong>Additional charges · </strong>'+E(r['extra_fees'])+'</p>')
    body.extend(detail(k,v) for k,v in [
        ('Academic fit / selection',r['requirements']),('German / teaching language',r['german']),
        ('Study format',r['mode']),('Tuition conditions',r['tuition_note']),
        ('Semester contribution',r['semester_note']),('Extra charges',r['extra_fees']),
        ('Fee reference',r['fee_basis']),('How to apply',r['application_route']),
        ('Winter 2026/27',r['winter_note'])])
    body.append('</dl><p class="sources">'+''.join(link(s['url'],s['label']) for s in r['sources'])+'</p>')
    body.append(f'<p class="evidence-level">{E(r["evidence_level"])} · Checked 4 October 2026. The university makes the final eligibility decision.</p></details>')
    body.append(f'<a class="button database-link" href="databases.html#application-{E(r["id"])}">Track in Databases →</a></article>')
    return '\n'.join(body)

def select(id,label,options,cls=''):
    return f'<label'+(f' class="{cls}"' if cls else '')+f' for="{id}">{E(label)}<select id="{id}" name="{id}">'+''.join(f'<option value="{E(v)}">{E(t)}</option>' for v,t in options)+'</select></label>'

potential=sum(r['candidate'] for r in ROWS)
excluded=len(ROWS)-potential
fields=sorted({r['field'] for r in ROWS})
filters=''.join([
    '<label class="search-field" for="search">Search programmes<input id="search" name="search" type="search" autocomplete="off" placeholder="Subject, university, city or requirement…"></label>',
    select('scope','Show',[('potential','Potential routes'),('start','Starting points'),('all','All reviewed'),('excluded','Known barriers')]),
    select('field','Subject',[('','All subjects')]+[(f,f) for f in fields]),
    select('intake','Intake',[('','All next intakes'),('Summer 2027','Summer 2027'),('Winter 2027/28','Winter 2027/28'),('Winter 2026/27','Winter 2026/27 — no verified match'),('Winter 2028/29','Winter 2028/29')]),
    select('english','English requirement',[('','Include IELTS retake'),('Score within 6.0','Published score ≤ 6.0'),('Higher score / C1 assessment','Higher score / C1'),('Assessment / confirm','Interview / confirm')]),
    select('tuition','Tuition per semester',[('','All costs'),('zero','€0 tuition'),('low','Up to €1,500'),('unknown','Amount unverified')]),
    select('sort','Sort by',[('priority','Research priority'),('deadline','Next planning deadline'),('fees','Semester contribution'),('university','University A–Z')]),
    '<button class="button reset" type="reset">Reset filters</button>'
])
quick=''.join(f'<button type="button" data-preset="{key}" aria-pressed="{str(key=="potential").lower()}">{label}</button>' for key,label in [('potential','Potential routes'),('start','Starting points'),('summer','Summer 2027'),('score','IELTS 6.0 or lower'),('all','All reviewed')])
inline_data=json.dumps(DATA,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('&','\\u0026')
template='''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>All applications · German public master’s · EcoSapien</title>
<meta name="description" content="Compare German public-university master’s routes for Home Science and design backgrounds: requirements, deadlines, tuition, semester charges and official links.">
<meta name="theme-color" content="#f4f2eb"><link rel="canonical" href="https://www.ecosapien.de/all-applications.html">
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<!-- STYLES -->
<meta property="og:type" content="website"><meta property="og:site_name" content="EcoSapien">
<meta property="og:title" content="All applications · German public master’s">
<meta property="og:description" content="A researched application guide across nutrition, health, design, education and more. Dates and qualification conditions are clearly marked.">
<meta property="og:url" content="https://www.ecosapien.de/all-applications.html"><meta name="twitter:card" content="summary">
</head><body class="masters">
<a class="skip-link" href="#main-content">Skip to applications</a>
<div class="wrap">
<header class="site-header"><a class="brand" href="./">EcoSapien</a><nav aria-label="Main"><a href="./#works">Works</a><a href="./#about">About</a><a href="applications.html">Art application</a><a href="all-applications.html" aria-current="page">All applications</a><a href="databases.html">Databases</a></nav></header>
<main id="main-content">
<section class="hero" aria-labelledby="page-title"><div><p class="eyebrow">Germany · Public universities · Master’s</p><h1 id="page-title">Your next<br>master’s degree.</h1></div><div class="intro"><p>Explore English-language routes across nutrition, health, design, education and more. Check the academic fit, compare the costs, and keep your applications in one place.</p><div class="hero-actions"><a class="button primary" href="#programmes">Explore programmes <span aria-hidden="true">↓</span></a><a href="all-applications.csv" download>Download CSV</a><a href="all-applications-offline.html" download>Save offline HTML</a></div></div></section>
<section class="research-summary" aria-label="Research snapshot"><p><strong>@@COUNT@@</strong><span>routes reviewed</span></p><p><strong>@@POTENTIAL@@</strong><span>conditional routes to check</span></p><p><strong>0</strong><span>verified open winter 2026 matches</span></p><p class="checked"><span class="eyebrow">Research checked</span><strong>4 October 2026</strong></p></section>
<aside class="winter-note" aria-labelledby="winter-title"><div><p class="eyebrow">Winter 2026/27</p><h2 id="winter-title">No suitable open route verified.</h2><a href="https://www.hs-fulda.de/en/studyprogramme/nutrition-health-and-food-systems-msc" target="_blank" rel="noopener noreferrer">Fulda admissions &amp; contact <span aria-hidden="true">↗</span></a></div><div><p>Among the programmes checked, none had a confirmed remaining winter application route matching this profile. Fulda’s Nutrition, Health and Food Systems deadline was <strong>30 September 2026</strong>. Ask about an exceptional late place, but treat that as an enquiry.</p><p>The next regular opportunities are mostly <strong>summer 2027</strong> and <strong>winter 2027/28</strong>. An October or November deadline can belong to next year’s intake. Every card names the intake and whether the date is published or projected from an annual pattern.</p></div></aside>
<details class="profile-note"><summary>Working profile, eligibility limits &amp; fee assumptions</summary><div class="profile-lines"><p><strong>Academic profile:</strong> three-year Bachelor in Home Science with an interior design minor, first class; no additional German study credits. Management experience has since been confirmed; field-specific relevance and supporting evidence still need checking. German A1. IELTS retake is an option; courses requiring higher English scores stay in the comparison.</p><p><strong>Application category:</strong> Indian citizen with an Indian first degree, using the ordinary non-EU fee category. Living in Germany with a student residence permit does not automatically change the foreign-degree deadline or remove tuition.</p><p><strong>Still needed for a firm decision:</strong> recognised qualification assessment, official grading scale, full transcript and module descriptions. A three-year degree is not automatically recognised as 180 ECTS; “first class” is not automatically German 2.5. A design minor is not automatically equivalent to a design bachelor.</p><p><strong>Costs:</strong> tuition and semester contributions are separate. Amounts are the rates available in the checked sources, often 2026/27 or summer 2026; 2027 rates may change. Living expenses are excluded. Check extra service, workshop, assessment and application charges on each card.</p></div></details>
<section class="starting-points" aria-labelledby="starting-title"><div><p class="eyebrow">Begin with the subject fit</p><h2 id="starting-title">A few useful starting points.</h2><p>These deserve a transcript or portfolio check first. None is an admission guarantee.</p></div><ul class="starting-links"><li><a href="#route-daad-11011">Fulda · Nutrition, Health &amp; Food Systems</a><span>Home economics accepted · summer route · €0 tuition</span></li><li><a href="#route-daad-3687">Fulda / Kassel · Food Business &amp; Consumer Studies</a><span>Food / nutrition / consumer studies · €0 tuition</span></li><li><a href="#route-daad-9214">Bayreuth · Food System Sciences</a><span>Broad relevant disciplines · IELTS 6.0 · €0 tuition</span></li><li><a href="#route-daad-10685">Giessen · One Health</a><span>Home economics accepted · IELTS retake needed</span></li><li><a href="#route-daad-10713">Bonn · Planetary Health</a><span>Nutrition-related route · IELTS 6.5</span></li><li><a href="#route-daad-10627">Leuphana · Individual Research Master</a><span>All disciplines · methods credits + research proposal</span></li><li><a href="#route-daad-4556">Leuphana · Management &amp; Data Science</a><span>All disciplines · mathematical / computing preparation recommended</span></li><li><a href="#route-daad-10634">FH Potsdam · Child/hood &amp; Family</a><span>Related child / family studies · campus attendance</span></li><li><a href="#route-trier-gemstones">Trier · Gemstones &amp; Jewellery</a><span>Any recognised bachelor · artistic aptitude · summer route</span></li></ul></section>
<section id="programmes" aria-labelledby="programmes-title"><div class="section-heading"><h2 id="programmes-title">Find a route that fits.</h2><p id="result-count" role="status" aria-live="polite" aria-atomic="true">@@COUNT@@ reviewed routes</p></div>
<div class="tracker-toolbar" id="tracker-toolbar" hidden><p id="save-status" role="status" aria-live="polite">Browse programmes here. Keep your files and progress in <a href="databases.html">Databases</a>.</p><div class="toolbar-actions"><button class="button" type="button" id="export-csv">Export filtered CSV</button><a class="button" href="databases.html">Open Databases →</a></div></div>
<div class="quick-filters" id="quick-filters" aria-label="Quick views" hidden>@@QUICK@@</div>
<form id="filters" class="filters" aria-label="Filter master’s programmes" hidden>@@FILTERS@@</form>
<div class="filter-foot" id="filter-foot" hidden><p>“Potential” means a conditional route to investigate. @@EXCLUDED@@ reviewed routes have known barriers and appear under “All reviewed”.</p><a href="#research-method">Sources &amp; coverage</a></div>
<noscript><p class="noscript-note">All @@COUNT@@ reviewed routes are listed below, including the clearly labelled routes with known barriers. JavaScript enables filters and CSV exports. Use Databases for your private progress and files. Official links and the CSV work without it.</p></noscript>
<div class="programme-grid" id="programme-grid">@@CARDS@@</div>
<div class="no-results" id="no-results" hidden><h3>No matching routes</h3><p id="empty-explanation"></p><button type="button" class="button" id="reset-empty" hidden>Reset filters</button></div>
<div class="page-more" id="more-area" hidden><p id="more-count"></p><button class="button primary" type="button" id="show-more">Show 12 more</button> <button class="button" type="button" id="show-all">Show all matches</button></div>
</section>
<section class="next-steps" aria-labelledby="steps-title"><div><p class="eyebrow">Prepare once, apply carefully</p><h2 id="steps-title">Build your application file.</h2></div><div><ol><li><strong>Map the transcript.</strong> Collect the bachelor’s certificate, all mark sheets, grading scale and module descriptions. Highlight nutrition, chemistry/biology, child development, education, social sciences, research methods, statistics and design credits.</li><li><strong>Check the subject fit before paying.</strong> Send the relevant university your degree title, transcript and module descriptions. Ask it to confirm degree recognition, subject credits and any portfolio requirement. No application is guaranteed by this comparison.</li><li><strong>Prepare APS and qualification checks.</strong> For an Indian degree, verify the university’s APS requirement and whether your existing APS can be reused. Where required, request a uni-assist application assessment or VPD early; a VPD alone is not a completed university application.</li><li><strong>Choose an English target.</strong> IELTS 6.5 opens several useful options; 7.0 is common for health and social-science routes. Check the exact programme’s overall score, individual bands, Academic/General rules and certificate age before booking.</li><li><strong>Plan the change of study.</strong> Before withdrawing from your current institute, check your residence-permit conditions and the study-change procedure with the responsible Ausländerbehörde. Admission and residence permission are separate decisions.</li></ol><p class="guide-links"><a href="https://www.uni-assist.de/en/tools/info-country-by-country/details-country/country/in/" target="_blank" rel="noopener noreferrer">uni-assist: Indian documents</a> · <a href="https://www.uni-assist.de/en/how-to-apply/pay-all-fees/handling-fees/" target="_blank" rel="noopener noreferrer">uni-assist fees</a> · <a href="https://www.make-it-in-germany.com/en/visa-residence/types/studying" target="_blank" rel="noopener noreferrer">Official study-residence information</a></p><p class="small">uni-assist currently charges €75 for the first chosen course and €30 for each additional course in the same semester. Applying indiscriminately can be expensive; prioritise programmes whose academic requirements your documents support.</p></div></section>
<section class="research-method" id="research-method" aria-labelledby="method-title"><h2 id="method-title">A dated research guide.</h2><p>@@METHOD@@ This is a broad subject-based search, not a complete census of every German degree or a guarantee of eligibility. Home Science covers different subjects at different institutions, so the final shortlist depends on the transcript. The joint Fulda/Kassel Food Business programme is counted once.</p><p>Each card links to the official university programme, admissions information and/or the university-supplied DAAD record used. A university page takes precedence where it resolves a generic database label. Conflicting requirements and unavailable fee amounts remain marked. Future annual deadlines are planning dates until the university confirms the cycle; scholarship deadlines are separate.</p><p>The research catalogue is public. <a href="databases.html">Databases</a> brings art and master’s applications together with deadlines, progress charts, account management and private Drive documents. The downloaded offline HTML remains a research copy. The page does not submit applications.</p></section>
</main><footer><span>EcoSapien · Study &amp; applications</span><span><a href="applications.html">Art application</a><a href="all-applications.csv" download>Full CSV</a><a href="#page-title">Back to top ↑</a></span></footer>
</div>
<script id="application-data" type="application/json">@@DATA@@</script>
<!-- SCRIPT -->
</body></html>
'''
replacements={'COUNT':str(len(ROWS)),'POTENTIAL':str(potential),'EXCLUDED':str(excluded),
              'QUICK':quick,'FILTERS':filters,'CARDS':'\n'.join(card(r) for r in ROWS),
              'DATA':inline_data,'METHOD':E(DATA['method'])}
for k,v in replacements.items():template=template.replace('@@'+k+'@@',v)
assert '@@' not in template
scripts=['all-applications.js']
web=template.replace('<!-- STYLES -->','<link rel="stylesheet" href="assets/applications.css"><link rel="stylesheet" href="assets/all-applications.css">').replace('<!-- SCRIPT -->',''.join(f'<script src="assets/{s}?v=20261004-databases"></script>' for s in scripts))
(ROOT/'all-applications.html').write_text(web)

# A real standalone file: no asset fetches, build tools or server needed.
styles=(ROOT/'assets/applications.css').read_text()+'\n'+(ROOT/'assets/all-applications.css').read_text()
script='\n'.join((ROOT/'assets'/s).read_text() for s in scripts)
offline=template.replace('<!-- STYLES -->','<style>'+styles+'</style>').replace('<!-- SCRIPT -->','<script>'+script+'</script>')
offline=offline.replace('<body class="masters">','<body class="masters" data-offline="true">')
for old,new in [
    ('href="./"','href="https://www.ecosapien.de/"'),('href="./#works"','href="https://www.ecosapien.de/#works"'),
    ('href="./#about"','href="https://www.ecosapien.de/#about"'),('href="applications.html"','href="https://www.ecosapien.de/applications.html"'),
    ('href="all-applications.html"','href="https://www.ecosapien.de/all-applications.html"'),
    ('href="databases.html"','href="https://www.ecosapien.de/databases.html"'),
    ('href="all-applications.csv"','href="https://www.ecosapien.de/all-applications.csv"'),
    ('href="all-applications-offline.html"','href="https://www.ecosapien.de/all-applications-offline.html"'),
    ('href="application-privacy.html"','href="https://www.ecosapien.de/application-privacy.html"'),
    ('href="google-drive-setup.html"','href="https://www.ecosapien.de/google-drive-setup.html"')]:
    offline=offline.replace(old,new)
offline=offline.replace('href="databases.html#', 'href="https://www.ecosapien.de/databases.html#')
offline=offline.replace('<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">','')
(ROOT/'all-applications-offline.html').write_text(offline)

def safe_cell(value):
    s='' if value is None else str(value)
    if s.lstrip().startswith(('=','+','-','@')) or s.startswith(('\t','\r','\n')):s="'"+s
    return s

with (ROOT/'all-applications.csv').open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.writer(f,lineterminator='\n')
    writer.writerow([title for _,title in COLUMNS])
    for r in ROWS:
        values={**r,'sources':' | '.join(s['url'] for s in r['sources']),
                'candidate':'Conditional investigation' if r['candidate'] else 'Known barrier / screened out',
                'shortlisted':'No','application_stage':'Not started','notes':'',
                'application_folder':'','document_progress':'0 / 9 documents marked ready'}
        values.update({key+'_status':'Needed' for key,_ in DOCUMENT_TYPES})
        writer.writerow([safe_cell(values.get(k,'')) for k,_ in COLUMNS])
print(f'Built {len(ROWS)} cards, CSV and standalone HTML from data/all-applications.json.')

# Rebuild the companion dashboard from both research sources.
from build_databases import build as build_databases
build_databases()
