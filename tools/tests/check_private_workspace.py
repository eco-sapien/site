"""Browser checks with a synthetic Supabase SDK; no real account or documents.

Serve the repository on port 8765; start isolated Firefox with Marionette.
PostgreSQL/RLS itself is exercised by check_supabase_sql.mjs.
"""
import json
import time
from pathlib import Path
from marionette import Browser

BASE = 'http://127.0.0.1:8765/'
ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).with_name('workspace.generated.html')
ROW = '#application-daad-11011'

def async_script(b, script):
    result = b.call('WebDriver:ExecuteAsyncScript', {'script': script, 'args': [], 'newSandbox': False, 'sandbox': None, 'scriptTimeout': 14000})
    return result.get('value', result) if isinstance(result, dict) else result

def wait(b, expression):
    result = async_script(b, """const done=arguments[arguments.length-1];let count=0;
      const tick=()=>{try{if(EXPRESSION)return done(true);}catch{}if(++count>200)return done((document.getElementById('save-status')?.textContent||'')+' / '+(document.getElementById('login-message')?.textContent||'')+' / '+JSON.stringify(window.__errors));setTimeout(tick,50);};tick();""".replace('EXPRESSION', expression))
    assert result is True, result

def fixture(seed=None, unconfigured=False):
    source = (ROOT/'databases.html').read_text()
    script = """<script src="tools/tests/mock_supabase.js"></script><script>
      window.__mock=createSupabaseMock(SEED);window.ECOSAPIEN_SUPABASE=window.__mock.config;window.EcoCloudSDK=window.__mock.sdk;
      window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
      window.confirm=()=>true;window.__originalCreate=URL.createObjectURL;URL.createObjectURL=blob=>{window.__download=blob;return window.__originalCreate(blob);};
      window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__downloadName=this.download;return;}return window.__anchorClick.call(this);};
    </script>""".replace('SEED',json.dumps(seed).replace('<','\\u003c'))
    if unconfigured:
        script=script.replace('window.ECOSAPIEN_SUPABASE=window.__mock.config;', 'window.ECOSAPIEN_SUPABASE={};')
    source=source.replace('<head>','<head><base href="/">').replace('<script src="assets/application-model.js',script+'<script src="assets/application-model.js')
    FIXTURE.write_text(source)

def login(b, email='owner@example.test'):
    b.script("document.getElementById('account-login').click();document.getElementById('login-email').value="+json.dumps(email)+";document.getElementById('login-password').value='synthetic-password';document.getElementById('login-form').dispatchEvent(new Event('submit',{cancelable:true}));")
    wait(b, "!document.getElementById('login-dialog').open&&!document.getElementById('account-signout').hidden&&!document.querySelector('[data-private-fields]').hidden")

def reveal(b):
    b.script("location.hash='#application-daad-11011';window.dispatchEvent(new HashChangeEvent('hashchange'));")
    wait(b, "document.querySelectorAll('#application-daad-11011 [data-document-row]').length===9")

def upload(b, target, name='Final CV.pdf', complete=True):
    b.script(target + ";const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4\\nTest document'],"+json.dumps(name)+",{type:'application/pdf'}));const input=document.getElementById('document-file');input.files=dt.files;input.dispatchEvent(new Event('change'));")
    if complete:
        wait(b, "document.getElementById('upload-message').textContent.includes('uploaded and attached')&&!document.getElementById('sync-workspace').disabled")

def download_text(b):
    return async_script(b, "const done=arguments[arguments.length-1];window.__download.text().then(done);")

def sync(b):
    wait(b,"!document.getElementById('sync-workspace').disabled")
    b.script("document.getElementById('sync-workspace').click();")
    wait(b,"document.getElementById('save-status').textContent==='Up to date with the shared workspace.'")

def restore(b, data):
    b.script("const dt=new DataTransfer();dt.items.add(new File(["+json.dumps(json.dumps(data))+"],'progress.json',{type:'application/json'}));const input=document.getElementById('backup-file');input.files=dt.files;input.dispatchEvent(new Event('change'));")

b=Browser()
try:
    b.call('WebDriver:SetWindowRect', {'width':1440,'height':1080})
    fixture(unconfigured=True)
    b.call('WebDriver:Navigate', {'url':BASE+'tools/tests/workspace.generated.html'})
    b.check('unconfigured public page is usable and private statistics are empty', "return document.getElementById('stat-tracked').textContent==='—'&&document.getElementById('database-count').textContent==='149 matching programmes · 12 shown';")
    b.script("document.getElementById('account-login').click();")
    b.check('incomplete connection is explained without accepting a password', "return document.getElementById('login-dialog').open&&document.getElementById('login-submit').disabled&&!document.getElementById('login-setup-note').hidden;")
    b.script("localStorage.setItem('ecosapien-all-applications-v1',JSON.stringify({version:1,progress:{'daad-11011':{saved:true,stage:'Preparing',notes:'Private legacy note'}}}));")
    fixture()
    b.call('WebDriver:Navigate', {'url':BASE+'tools/tests/workspace.generated.html'})
    b.check('private legacy notes are not loaded before sign-in', "return !document.getElementById('legacy-notice').hidden&&[...document.querySelectorAll('[data-notes]')].every(e=>e.value==='')&&document.getElementById('workspace-updates').hidden;")
    b.script("document.getElementById('account-login').click();")
    b.screenshot('ma-supabase-login.png')
    login(b)
    reveal(b)
    b.check('owner has shared progress, resources and member controls', "return document.getElementById('account-title').textContent==='Synthetic shared workspace'&&!document.getElementById('invite-controls').hidden&&document.querySelectorAll('[data-library-upload]').length===9;")
    b.script("window.__mock.failSave='before';document.getElementById('import-browser').click();")
    wait(b,"document.getElementById('save-status').textContent.includes('Save not yet confirmed')")
    b.check('failed migration keeps the old browser copy', "return localStorage.getItem('ecosapien-all-applications-v1').includes('Private legacy note');")
    b.script("document.getElementById('import-browser').click();")
    wait(b,"document.getElementById('legacy-notice').hidden")
    b.check('confirmed migration removes local plaintext and tracks the application', "return localStorage.getItem('ecosapien-all-applications-v1')===null&&document.getElementById('stat-tracked').textContent==='1';")
    upload(b,"document.querySelector('#application-daad-11011 [data-upload-start]').click()")
    b.check('programme upload updates readiness and attribution', "return document.querySelector('#application-daad-11011 [data-count]').textContent==='1 / 9 ready'&&window.__mock.state.files[0].record_id==='daad-11011'&&window.__mock.state.files[0].slot==='cv'&&document.getElementById('activity-list').textContent.includes('Test owner uploaded Final CV.pdf');")
    b.script("document.querySelector('#application-daad-11011 [data-download]').click();")
    wait(b,"window.__downloadName==='Final CV.pdf'")
    assert download_text(b)=='%PDF-1.4\nTest document'
    print('PASS private file download preserves original bytes and filename',flush=True)
    upload(b,"document.querySelector('[data-library-upload=transcript]').click()", 'Transcript.pdf')
    b.check('shared file fallback does not mark unfinished slots ready', "return document.querySelector('#application-daad-11011 [data-document-row=transcript] [data-file-origin]').textContent==='Shared: Transcript.pdf'&&document.querySelector('#application-daad-11011 [data-count]').textContent==='1 / 9 ready';")
    upload(b,"document.querySelector('#application-daad-11011 [data-document-row=cv] [data-document-upload]').click()", 'Revised CV.pdf')
    b.script("document.querySelector('#application-daad-11011 [data-versions]').click();")
    b.check('version history retains old and new documents', "return document.getElementById('versions-dialog').open&&document.querySelectorAll('#versions-list>li').length===2&&document.getElementById('versions-list').textContent.includes('Final CV.pdf')&&document.getElementById('versions-list').textContent.includes('Revised CV.pdf · Current');")
    b.script("[...document.querySelectorAll('#versions-list button')].find(e=>e.textContent==='Use this version').click();document.getElementById('close-versions').click();")
    sync(b)
    b.check('selecting an older version updates only the file reference', "const id=window.__mock.state.fields.find(f=>f.record_id==='daad-11011'&&f.field==='documents.cv.file_id').value;return window.__mock.state.files.find(f=>f.id===id).filename==='Final CV.pdf'&&window.__mock.state.files.length===3;")
    b.script("for(const key of ['employment','reference','aps']){const s=document.querySelector('#application-daad-11011 [data-document-row='+key+'] select');s.value='Not required';s.dispatchEvent(new Event('change'));}")
    b.check('progress excludes documents marked Not required', "return document.querySelector('#application-daad-11011 [data-percent]').textContent==='17%'&&document.getElementById('overall-percent').textContent==='17%';")
    sync(b)
    b.script("const n=document.querySelector('#application-daad-11011 [data-notes]');n.value='Private concurrent note';n.dispatchEvent(new Event('input'));window.__mock.setField('daad-11011','stage','Submitted');window.__mock.activity('progress_updated','daad-11011',{changes:[]},null,window.__mock.state.members.find(m=>m.actor_kind==='agent'));")
    wait(b,"document.querySelector('#application-daad-11011 [data-stage]').value==='Submitted'")
    wait(b,"document.getElementById('save-status').textContent==='All changes saved to the shared workspace.'")
    b.check('agent updates arrive without erasing another field being edited', "return document.querySelector('#application-daad-11011 [data-notes]').value==='Private concurrent note'&&document.getElementById('activity-list').textContent.includes('Application agent · Agent updated');")
    b.script("window.__mock.failSave='after';const n=document.querySelector('#application-daad-11011 [data-notes]');n.value='=HYPERLINK(\"test\") Private test note';n.dispatchEvent(new Event('input'));")
    wait(b,"document.getElementById('save-status').textContent.includes('Save not yet confirmed')")
    b.script("window.__lastRequest=window.__mock.calls.filter(c=>c.name==='eco_save').at(-1).args.p_request;document.getElementById('retry-save').click();")
    wait(b,"document.getElementById('save-status').textContent==='All changes saved to the shared workspace.'")
    b.check('lost save response retries with the same identifier', "return window.__lastRequest===window.__mock.calls.filter(c=>c.name==='eco_save').at(-1).args.p_request;")
    b.script("document.getElementById('backup-progress').click();")
    backup=json.loads(download_text(b))
    assert backup['version']==4 and backup['workspace_id']==b.script('return window.__mock.config.workspaceId;')
    assert backup['progress']['daad-11011']['documents']['cv']['file_id']
    assert 'access_token' not in json.dumps(backup) and 'synthetic-session-only' not in json.dumps(backup)
    foreign=json.loads(json.dumps(backup));foreign['workspace_id']='dddddddd-dddd-4ddd-addd-dddddddddddd'
    restore(b,foreign)
    wait(b,"document.getElementById('save-status').textContent.includes('different workspace')")
    b.check('a foreign-workspace backup is rejected before changing progress', "return document.querySelector('#application-daad-11011 [data-notes]').value.includes('Private test note');")
    b.check('tokens, notes and upload URLs are not persisted in browser storage', "return !JSON.stringify(localStorage).includes('Private test note')&&!Object.keys(localStorage).some(k=>k.startsWith('sb-')||k.startsWith('tus::'))&&sessionStorage.length===0;")
    b.script("document.getElementById('database-filters').reset();")
    wait(b,"document.getElementById('database-count').textContent.startsWith('149 ')")
    b.script("document.getElementById('export-csv').click();")
    csv=download_text(b)
    assert "'=HYPERLINK" in csv and 'CV private file ID' in csv
    print('PASS backup and CSV retain private references without tokens or formula injection',flush=True)
    b.script("document.getElementById('invite-email').value='new@example.test';document.getElementById('invite-name').value='New member';document.getElementById('invite-form').dispatchEvent(new Event('submit',{cancelable:true}));")
    wait(b,"document.getElementById('invitation-list').textContent.includes('new@example.test')")
    b.check('invitation clearly states that it does not send email', "return document.getElementById('member-message').textContent.includes('No invitation email was sent');")
    b.script("window.__mock.holdUpload=true;")
    upload(b,"document.querySelector('[data-library-upload=degree]').click()", 'Cancelled.pdf',False)
    wait(b,"!document.getElementById('cancel-upload').hidden")
    b.script("document.getElementById('cancel-upload').click();")
    wait(b,"document.getElementById('upload-message').textContent.includes('Upload cancelled')")
    b.check('cancelled upload never marks a document complete', "return !window.__mock.state.files.some(f=>f.filename==='Cancelled.pdf');")
    b.script("window.__mock.holdUpload=false;")
    # Version 2 imports preserve unrelated progress and exercise combined charts.
    seed={'version':2,'progress':{
      'trier-gemstones':{'saved':True,'stage':'Submitted'},
      'art-vienna-art-science':{'saved':True,'stage':'Preparing','deadline':'2027-02-01','deadline_confirmed':True},
      'art-umprum-visual-arts':{'saved':True,'stage':'Offer received'},
      'weimar-media-art':{'saved':True,'stage':'Unsuccessful'}
    }}
    restore(b,seed)
    wait(b,"document.getElementById('save-status').textContent==='All changes saved to the shared workspace.'")
    b.check('combined art and masters tracker counts stages correctly', "return document.getElementById('stat-tracked').textContent==='5'&&document.getElementById('stat-submitted').textContent==='3'&&document.getElementById('stat-offers').textContent==='1 offers received';")
    b.script("document.querySelector('[data-overview-filter=submitted]').click();")
    wait(b,"document.querySelectorAll('#database-list .application-record').length===3")
    b.check('clicking chart totals filters the application list', "return [...document.querySelectorAll('#database-list [data-stage]')].every(e=>['Submitted','Offer received'].includes(e.value));")
    b.script("document.getElementById('overview').scrollIntoView();")
    b.screenshot('ma-supabase-overview.png')
    b.call('WebDriver:SetWindowRect', {'width':540,'height':900})
    b.check('dashboard fits a narrow window', "return document.documentElement.scrollWidth<=window.innerWidth;")
    b.script("document.getElementById('workspace-updates').scrollIntoView();")
    b.screenshot('ma-supabase-activity-mobile.png')
    b.call('WebDriver:SetWindowRect', {'width':1440,'height':1080})
    b.script("document.getElementById('account-signout').click();")
    wait(b,"document.getElementById('stat-tracked').textContent==='—'")
    b.check('sign-out clears notes, filenames, activity, members and dialogs', "return [...document.querySelectorAll('[data-notes]')].every(e=>e.value==='')&&document.getElementById('activity-list').childElementCount===0&&document.getElementById('member-list').childElementCount===0&&document.getElementById('versions-list').childElementCount===0&&!document.body.innerText.includes('Final CV.pdf');")
    login(b,'viewer@example.test')
    reveal(b)
    b.check('viewer can download and inspect history but cannot edit or invite', "return document.querySelector('#application-daad-11011 [data-upload-start]').disabled&&document.querySelector('#application-daad-11011 [data-notes]').disabled&&!document.querySelector('#application-daad-11011 [data-download]').disabled&&document.getElementById('invite-controls').hidden&&document.getElementById('restore-progress').hidden;")
    b.script("window.__mock.revoked=true;document.getElementById('sync-workspace').click();")
    wait(b,"document.getElementById('stat-tracked').textContent==='—'")
    b.check('revoked membership immediately clears the private UI on refresh', "return document.getElementById('account-signout').hidden&&document.getElementById('activity-list').childElementCount===0&&document.getElementById('save-status').textContent.includes('access needs to be checked');")
    b.script("window.__mock.revoked=false;window.__mock.holdAuth=true;document.getElementById('account-login').click();document.getElementById('login-email').value='owner@example.test';document.getElementById('login-password').value='synthetic-password';document.getElementById('login-form').dispatchEvent(new Event('submit',{cancelable:true}));")
    wait(b,"!!window.__mock.releaseAuth")
    b.script("document.getElementById('account-signout').click();window.__mock.releaseAuth();")
    time.sleep(.3)
    b.check('late sign-in cannot repopulate a signed-out workspace', "return document.getElementById('stat-tracked').textContent==='—'&&document.getElementById('account-signout').hidden&&window.__mock.session===null;")
    b.check('no uncaught browser exceptions', "return window.__errors.length===0;")
    b.call('WebDriver:Navigate', {'url':BASE+'all-applications.html'})
    b.check('public masters research has no account window', "return !document.getElementById('login-dialog')&&!!document.querySelector('a[href=\"databases.html\"]');")
    b.call('WebDriver:Navigate', {'url':BASE+'applications.html'})
    b.check('art research still links to the shared dashboard', "return document.querySelectorAll('.database-link').length===24;")
    print('All Supabase workspace browser checks passed.',flush=True)
finally:
    FIXTURE.unlink(missing_ok=True)
    b.call('WebDriver:DeleteSession')
