"""Databases browser checks with synthetic OAuth/Drive, never a real account."""
import json
import time
from pathlib import Path
from marionette import Browser

BASE = 'http://127.0.0.1:8765/'
ROW = '#application-daad-11011'

def async_script(b, script):
    result = b.call('WebDriver:ExecuteAsyncScript', {'script': script, 'args': [], 'newSandbox': False, 'sandbox': None, 'scriptTimeout': 14000})
    return result.get('value', result) if isinstance(result, dict) else result

def wait(b, expression):
    for attempt in range(4):
        try:
            result = async_script(b, '''const done=arguments[arguments.length-1];let count=0;
              const tick=()=>{try{if(EXPRESSION)return done(true);}catch{}if(++count>200)return done((document.getElementById('save-status')?.textContent||'')+' / '+(document.getElementById('login-message')?.textContent||''));setTimeout(tick,50);};tick();'''.replace('EXPRESSION', expression))
            if result is None and attempt < 3:
                time.sleep(0.1)
                continue
            assert result is True, result
            return
        except RuntimeError as error:
            if 'Document was unloaded' not in str(error) or attempt == 3:
                raise
            time.sleep(0.1)

def fixture(b, snapshot=None):
    b.script(Path(__file__).with_name('mock_drive.js').read_text() + '''
      window.__mock=createDriveMock();window.fetch=window.__mock.request;window.__account='account-a';window.__errors=[];
      window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
      window.confirm=()=>true;
      window.google={accounts:{oauth2:{hasGrantedAllScopes:(r,s)=>r.scope===s,
        initTokenClient:config=>({requestAccessToken:()=>{window.__oauthCallback=config.callback;if(!window.__holdAuth)setTimeout(()=>config.callback({access_token:window.__account,expires_in:3600,scope:DriveWorkspace.scope}),0);}})}}};
      window.__originalCreate=URL.createObjectURL;URL.createObjectURL=blob=>{window.__download=blob;return window.__originalCreate(blob);};
      window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__downloadName=this.download;return;}return window.__anchorClick.call(this);};
    ''')
    if snapshot:
        b.script('window.__mock.restore(' + json.dumps(snapshot) + ');')

def login(b):
    b.script("document.getElementById('account-login').click();")
    wait(b, "!document.getElementById('google-connect').disabled")
    b.script("document.getElementById('google-connect').click();")
    wait(b, "!document.getElementById('account-signout').hidden&&!document.getElementById('login-dialog').open&&!document.querySelector('[data-private-fields]').disabled")

def reveal(b):
    b.script('location.hash=' + json.dumps(ROW) + ";window.dispatchEvent(new HashChangeEvent('hashchange'));")
    wait(b, "document.querySelectorAll('#application-daad-11011 [data-document-row]').length===9")

def upload(b, target, name='Final CV.pdf', wait_for_save=True):
    b.script(target + ";const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4\\nTest document']," + json.dumps(name) + ",{type:'application/pdf'}));const input=document.getElementById('document-file');input.files=dt.files;input.dispatchEvent(new Event('change'));")
    if wait_for_save:
        wait(b, "document.getElementById('upload-message').textContent.includes('uploaded and attached')")

def download_text(b):
    return async_script(b, "const done=arguments[arguments.length-1];window.__download.text().then(done);")

def sync(b):
    wait(b, "!document.getElementById('sync-drive').disabled")
    b.script("document.getElementById('sync-drive').click();")
    wait(b, "document.getElementById('save-status').textContent==='Up to date with your Google Drive.'")

def wait_for_login_redirect(b):
    # Async scripts are cancelled by a document navigation. Poll the driver
    # across the redirect, then check the modal in the settled destination.
    for _ in range(100):
        url = b.call('WebDriver:GetCurrentURL')
        if isinstance(url, dict):
            url = url.get('value', '')
        if url.endswith('/databases.html#login'):
            if b.script("return document.readyState==='complete'&&!!document.getElementById('login-dialog')?.open;"):
                return
        time.sleep(0.1)
    raise AssertionError('The old login link did not open Databases sign-in')

b = Browser()
try:
    b.call('WebDriver:SetWindowRect', {'width': 1440, 'height': 1080})
    b.call('WebDriver:Navigate', {'url': BASE + 'databases.html'})
    b.script("localStorage.removeItem('ecosapien-google-client-id');localStorage.setItem('ecosapien-all-applications-v1',JSON.stringify({version:1,progress:{'daad-11011':{saved:true,stage:'Preparing',notes:'Private legacy note'}}}));")
    b.call('WebDriver:Refresh')
    b.check('signed-out dashboard hides private progress and preserves the legacy copy', "return document.getElementById('stat-tracked').textContent==='—'&&[...document.querySelectorAll('[data-notes]')].every(e=>e.value==='')&&document.querySelector('[data-private-fields]').hidden&&!document.getElementById('legacy-notice').hidden;")
    b.check('149 combined routes are browsable with progress and upload controls', "return document.getElementById('database-count').textContent==='149 matching programmes · 12 shown'&&document.querySelectorAll('[data-upload-start]').length===12&&document.querySelectorAll('[data-readiness]').length===12;")
    b.script("document.getElementById('account-login').click();")
    b.check('missing client ID is explained on Databases', "return document.getElementById('login-dialog').open&&document.getElementById('google-connect').disabled&&document.getElementById('google-setup').open;")
    b.screenshot('ma-databases-google-setup.png')
    fixture(b)
    b.script("document.getElementById('google-client-id').value='123456789012-test-client.apps.googleusercontent.com';document.getElementById('google-config-form').dispatchEvent(new Event('submit',{cancelable:true}));")
    wait(b, "!document.getElementById('google-connect').disabled")
    b.script("document.getElementById('google-connect').click();")
    wait(b, "!document.getElementById('login-dialog').open")
    b.check('Google account shown and nine shared uploads unlocked', "return document.getElementById('account-title').textContent==='account-a@example.test'&&!document.querySelector('[data-private-fields]').disabled&&document.querySelectorAll('[data-library-upload]').length===9;")
    reveal(b)
    b.script("window.__mock.failSave='before';document.getElementById('import-browser').click();")
    wait(b, "document.getElementById('save-status').textContent.includes('not been confirmed saved')")
    b.check('failed migration retains its recoverable browser copy', "return localStorage.getItem('ecosapien-all-applications-v1').includes('Private legacy note')&&document.querySelector('#application-daad-11011 [data-notes]').value==='Private legacy note';")
    b.script("document.getElementById('import-browser').click();")
    wait(b, "document.getElementById('legacy-notice').hidden")
    b.check('durable migration preserves the programme ID and clears plaintext', "return localStorage.getItem('ecosapien-all-applications-v1')===null&&document.getElementById('stat-tracked').textContent==='1';")
    upload(b, "document.querySelector('#application-daad-11011 [data-upload-start]').click()")
    b.check('row upload attaches the programme CV and updates readiness', "const c=document.getElementById('application-daad-11011');return c.querySelector('[data-document-row=cv] select').value==='Ready'&&c.querySelector('[data-document-row=cv] input').value.startsWith('https://drive.google.com/file/d/')&&c.querySelector('[data-count]').textContent==='1 / 9 ready'&&!c.querySelector('[data-download]').disabled;")
    b.script("document.querySelector('#application-daad-11011 [data-download]').click();")
    wait(b, "window.__downloadName==='Final CV.pdf'")
    assert download_text(b) == '%PDF-1.4\nTest document'
    print('PASS selected document downloads with original bytes and name', flush=True)
    upload(b, "document.querySelector('[data-library-upload=transcript]').click()", 'Transcript.pdf')
    b.check('shared transcript supplies a default without inventing completed work', "return document.getElementById('library-transcript').value===document.querySelector('#application-daad-11011 [data-document-row=transcript] [data-document-open]').href&&document.querySelector('#application-daad-11011 [data-count]').textContent==='1 / 9 ready';")
    upload(b, "document.querySelector('#application-daad-11011 [data-document-row=cv] [data-document-upload]').click()", 'Revised CV.pdf')
    b.check('replacements preserve earlier files inside the correct slot folder', "const f=[...window.__mock.files.values()].filter(f=>f.appProperties?.eco_slot==='cv');return f.length===2&&f[0].parents[0]===f[1].parents[0]&&window.__mock.files.get(f[0].parents[0]).appProperties.eco_kind==='slot-cv';")
    b.script("for(const key of ['employment','reference','aps']){const s=document.querySelector('#application-daad-11011 [data-document-row='+key+'] select');s.value='Not required';s.dispatchEvent(new Event('change'));}")
    b.check('progress bar and donut exclude slots marked Not required', "return document.querySelector('#application-daad-11011 [data-percent]').textContent==='17%'&&document.querySelector('#application-daad-11011 [data-count]').textContent==='1 / 6 ready'&&document.getElementById('overall-percent').textContent==='17%';")
    b.script("const n=document.querySelector('#application-daad-11011 [data-notes]');n.value='=HYPERLINK(\"test\") Private test note';n.dispatchEvent(new Event('input'));const d=document.querySelector('#application-daad-11011 [data-deadline]');const date=new Date(ApplicationModel.today()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+10);d.value=date.toISOString().slice(0,10);d.dispatchEvent(new Event('change'));document.querySelector('#application-daad-11011 [data-deadline-confirmed]').click();")
    sync(b)
    b.script("document.getElementById('backup-progress').click();")
    backup = json.loads(download_text(b))
    assert backup['version'] == 3 and 'access_token' not in json.dumps(backup)
    assert backup['progress']['daad-11011']['deadline_confirmed'] is True
    b.check('private state and tokens never enter persistent browser storage', "return Object.keys(localStorage).every(k=>!k.includes('ecosapien-all-applications'))&&!JSON.stringify(localStorage).includes('Private test note')&&sessionStorage.length===0;")
    b.script("document.getElementById('database-filters').reset();")
    wait(b, "document.getElementById('database-count').textContent.startsWith('149 ')")
    b.script("document.getElementById('export-csv').click();")
    csv = download_text(b)
    assert "'=HYPERLINK" in csv and 'CV status' in csv and 'https://drive.google.com/file/d/' in csv
    print('PASS private backup and CSV contain file links and deadlines, exclude tokens and escape formulas', flush=True)
    snapshot = b.script('return window.__mock.export();')
    b.call('WebDriver:Refresh')
    b.check('reload requires fresh Google authorization', "return document.getElementById('stat-tracked').textContent==='—'&&[...document.querySelectorAll('[data-notes]')].every(e=>e.value==='');")
    fixture(b, snapshot)
    login(b)
    reveal(b)
    b.check('reload restores notes, files and confirmed deadline from Drive', "return document.querySelector('#application-daad-11011 [data-notes]').value.includes('Private test note')&&document.querySelector('#application-daad-11011 [data-document-row=cv] select').value==='Ready'&&document.querySelector('#application-daad-11011 [data-deadline-confirmed]').checked;")
    b.script("const i=document.querySelector('#application-daad-11011 [data-document-row=cv] input');i.value='https://drive.google.com.evil.example/file';i.dispatchEvent(new Event('change'));")
    b.check('unsafe pasted file URLs are rejected', "return !document.querySelector('#application-daad-11011 [data-document-row=cv] input').validity.valid;")
    sync(b)
    b.script("window.__mock.failAuth=true;document.getElementById('sync-drive').click();")
    wait(b, "document.getElementById('account-login').textContent==='Reconnect to Google'")
    b.check('expired access locks writes while retaining backup access', "return document.querySelector('[data-private-fields]').disabled&&!document.getElementById('backup-progress').hidden;")
    login(b)

    # Synthetic backup v2 tests dashboard aggregation; it is never published.
    b.script("""
      const date=days=>{const d=new Date(ApplicationModel.today()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
      const docs=n=>Object.fromEntries(ApplicationModel.documentTypes.map(([key],i)=>[key,{status:i<n?'Ready':'Needed',url:''}]));
      const seed={version:2,progress:{
        'trier-gemstones':{saved:true,stage:'Submitted',deadline:date(12),deadline_confirmed:true,documents:docs(9)},
        'art-vienna-art-science':{saved:true,stage:'Preparing',deadline:date(20),deadline_confirmed:true,documents:docs(5)},
        'art-gothenburg-jewellery':{saved:true,stage:'Check eligibility',deadline:date(40),deadline_confirmed:false,documents:docs(2)},
        'art-umprum-visual-arts':{saved:true,stage:'Offer received',documents:docs(9)},
        'art-eka-craft-studies':{saved:true,stage:'Preparing',documents:docs(4)},
        'art-oslo-material-art':{saved:true,stage:'Not pursuing'},
        'weimar-media-art':{saved:true,stage:'Unsuccessful'}
      }};
      const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(seed)],'progress.json',{type:'application/json'}));const input=document.getElementById('backup-file');input.files=dt.files;input.dispatchEvent(new Event('change'));
    """)
    wait(b, "document.getElementById('save-status').textContent==='All changes saved to your Google Drive.'")
    b.check('combined dashboard separates pending work, submissions, offers and closed routes', "return document.getElementById('stat-tracked').textContent==='8'&&document.getElementById('stat-preparing').textContent==='4'&&document.getElementById('stat-soon').textContent==='2'&&document.getElementById('stat-submitted').textContent==='2'&&document.getElementById('stat-offers').textContent==='1 offers received';")
    b.script("document.querySelector('[data-overview-filter=submitted]').click();")
    wait(b, "document.querySelectorAll('#database-list .application-record').length===2")
    b.check('Submitted / offers total opens exactly those routes', "return [...document.querySelectorAll('#database-list [data-stage]')].every(e=>['Submitted','Offer received'].includes(e.value));")
    b.script("document.getElementById('db-search').value='nothing matches';document.getElementById('db-search').dispatchEvent(new Event('input'));const button=[...document.querySelectorAll('#deadline-chart button')].find(e=>Number(e.querySelector('.month-count').textContent)>0);window.__monthExpected=Number(button.querySelector('.month-count').textContent);button.click();")
    wait(b, "document.querySelectorAll('#database-list .application-record').length===window.__monthExpected")
    b.check('month chart clears unrelated filters and excludes submitted routes', "return document.getElementById('db-search').value===''&&[...document.querySelectorAll('#database-list [data-stage]')].every(e=>['Preparing','Check eligibility','Not started'].includes(e.value));")
    b.script("document.getElementById('db-collection').value='masters';document.getElementById('db-collection').dispatchEvent(new Event('change'));[...document.querySelectorAll('#stage-pipeline button')].find(e=>e.textContent.includes('Check eligibility')).click();")
    wait(b, "document.querySelectorAll('#database-list .application-record').length===1")
    b.check('stage filters match global totals after earlier filters', "return document.getElementById('db-collection').value===''&&document.querySelector('#database-list [data-stage]').value==='Check eligibility';")
    b.script("document.querySelector('[data-overview-filter=tracked]').click();document.getElementById('overview').scrollIntoView();")
    b.screenshot('ma-databases-overview-desktop.png')
    b.script("document.getElementById('application-tracker').scrollIntoView();")
    b.screenshot('ma-databases-tracker-desktop.png')
    b.call('WebDriver:SetWindowRect', {'width': 390, 'height': 844})
    b.check('populated dashboard fits mobile', "return document.documentElement.scrollWidth<=window.innerWidth;")
    b.script("document.getElementById('overview').scrollIntoView();")
    b.screenshot('ma-databases-overview-mobile.png')
    reveal(b)
    b.script("document.getElementById('application-daad-11011').scrollIntoView();")
    b.check('expanded checklist fits mobile', "return document.documentElement.scrollWidth<=window.innerWidth;")
    b.screenshot('ma-databases-files-mobile.png')
    b.script("document.getElementById('resources').scrollIntoView();")
    b.check('shared resources fit mobile', "return document.documentElement.scrollWidth<=window.innerWidth;")
    b.script("window.__downloadName='';window.__mock.holdDownload=true;document.querySelector('#application-daad-11011 [data-download]').click();")
    wait(b, "!!window.__mock.releaseDownload")
    b.script("document.getElementById('account-signout').click();window.__mock.releaseDownload();window.__mock.holdDownload=false;")
    b.check('sign-out scrubs private fields and file links and aborts a download', "return [...document.querySelectorAll('[data-notes],[data-folder],[data-library-document],[data-document-url]')].every(e=>e.value==='')&&[...document.querySelectorAll('[data-document-open],[data-open-file],[data-open-folder],[data-library-open],#drive-upload')].every(e=>!e.hasAttribute('href'))&&document.getElementById('stat-tracked').textContent==='—'&&window.__downloadName===''&&window.__mock.downloadSignal.aborted;")
    b.script("window.__account='account-b';")
    login(b)
    b.check('different accounts cannot see each other’s progress', "return document.getElementById('account-title').textContent==='account-b@example.test'&&document.getElementById('stat-tracked').textContent==='0'&&[...document.querySelectorAll('[data-notes]')].every(e=>e.value==='');")
    reveal(b)
    b.script("window.__mock.holdUpload=true;")
    upload(b, "document.querySelector('#application-daad-11011 [data-upload-start]').click()", 'Cancelled.pdf', False)
    wait(b, "!!window.__mock.releaseUpload")
    b.script("document.getElementById('account-signout').click();window.__mock.releaseUpload();window.__mock.holdUpload=false;")
    b.check('late upload completion cannot restore signed-out progress', "return document.getElementById('upload-notice').hidden&&[...document.querySelectorAll('[data-document-url]')].every(e=>e.value==='');")
    b.script("window.__holdAuth=true;document.getElementById('account-login').click();")
    wait(b, "!document.getElementById('google-connect').disabled")
    b.script("document.getElementById('google-connect').click();document.getElementById('account-signout').click();window.__oauthCallback({access_token:'account-a',expires_in:3600,scope:DriveWorkspace.scope});")
    b.check('late OAuth callback cannot undo sign-out', "return document.getElementById('account-signout').hidden&&document.querySelector('[data-private-fields]').hidden;")
    b.check('account, upload, download and tracker flows have no uncaught errors', "return window.__errors.length===0;")
    b.script("window.__holdAuth=false;document.getElementById('account-login').click();")
    b.check('login dialog fits mobile', "const d=document.getElementById('login-dialog').getBoundingClientRect();return d.left>=0&&d.right<=innerWidth&&d.height<=innerHeight;")
    b.script("document.getElementById('close-login').click();localStorage.removeItem('ecosapien-google-client-id');")

    b.call('WebDriver:Navigate', {'url': BASE + 'all-applications.html'})
    b.check('All applications now contains public research and Databases links only', "return !document.getElementById('login-dialog')&&!document.getElementById('account-bar')&&!document.querySelector('[data-private-fields]')&&document.querySelectorAll('.programme-card').length===128&&document.querySelectorAll('a[href^=\"databases.html#application-\"]').length===128;")
    b.script("document.querySelector('[data-preset=all]').click();document.getElementById('show-all').click();")
    b.check('all 128 master routes still browse and filter', "return document.querySelectorAll('.programme-card:not([hidden])').length===128;")
    b.script("const i=document.getElementById('intake');i.value='Winter 2026/27';i.dispatchEvent(new Event('change'));")
    b.check('winter deadline finding remains intact', "return !document.getElementById('no-results').hidden&&document.getElementById('empty-explanation').textContent.includes('30 September');")
    b.call('WebDriver:Navigate', {'url': BASE + 'all-applications.html#login'})
    wait_for_login_redirect(b)
    print('PASS old login links redirect to Databases', flush=True)
    b.call('WebDriver:Navigate', {'url': (Path(__file__).resolve().parents[2] / 'all-applications-offline.html').as_uri()})
    b.check('offline research filters and live Databases links remain available', "return !document.getElementById('filters').hidden&&document.querySelectorAll('script[src],link[rel=stylesheet]').length===0&&!document.getElementById('login-dialog')&&!!document.querySelector('a[href^=\"https://www.ecosapien.de/databases.html\"]');")
    for page in ('google-drive-setup.html', 'application-privacy.html', 'index.html', 'studio.html', 'applications.html', '404.html'):
        b.call('WebDriver:Navigate', {'url': BASE + page})
        b.check(page + ' has a separate Databases tab and fits mobile', "const links=[...document.querySelectorAll('nav a')];return links.some(a=>a.textContent==='Art application')&&links.some(a=>a.textContent==='All applications')&&links.some(a=>a.textContent==='Databases'&&new URL(a.href).pathname==='/databases.html')&&!links.some(a=>a.textContent==='Login')&&document.documentElement.scrollWidth<=innerWidth;")
        if page == 'applications.html':
            b.check('all art routes link to stable dashboard entries', "return document.querySelectorAll('.database-link').length===24&&document.querySelector('#programme-1 .database-link').getAttribute('href')==='databases.html#application-trier-gemstones';")
    print('All mocked dashboard checks passed. Real Google consent still needs a client ID.', flush=True)
finally:
    b.call('WebDriver:DeleteSession')
    b.sock.close()
