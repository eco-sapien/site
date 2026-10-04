"""Browser integration against mocked OAuth and Drive; no real account access."""
import json
from pathlib import Path

from marionette import Browser

def async_script(browser, script):
    result = browser.call('WebDriver:ExecuteAsyncScript', {'script': script, 'args': [], 'newSandbox': False, 'sandbox': None, 'scriptTimeout': 14000})
    return result.get('value', result) if isinstance(result, dict) else result

def wait(browser, expression):
    result = async_script(browser, '''const done=arguments[arguments.length-1];let count=0;
      const tick=()=>{try{if(EXPRESSION)return done(true);}catch{}if(++count>200)return done(document.getElementById('save-status').textContent+' / '+document.getElementById('login-message').textContent);setTimeout(tick,50);};tick();'''.replace('EXPRESSION', expression))
    assert result is True, result

def fixture(browser, snapshot=None):
    browser.script(Path(__file__).with_name('mock_drive.js').read_text() + '''
      window.__mock=createDriveMock();window.fetch=window.__mock.request;window.__account='account-a';window.__errors=[];
      window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
      window.confirm=()=>true;
      window.google={accounts:{oauth2:{hasGrantedAllScopes:(r,s)=>r.scope===s,
        initTokenClient:config=>({requestAccessToken:()=>{window.__oauthCallback=config.callback;window.__oauthError=config.error_callback;if(!window.__holdAuth)setTimeout(()=>config.callback({access_token:window.__account,expires_in:3600,scope:DriveWorkspace.scope}),0);}})}}};
      window.__originalCreate=URL.createObjectURL;URL.createObjectURL=blob=>{window.__download=blob;return window.__originalCreate(blob);};
      window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__downloadName=this.download;return;}return window.__anchorClick.call(this);};
    ''')
    if snapshot:
        browser.script('window.__mock.restore(' + json.dumps(snapshot) + ');')

def login(browser):
    browser.script("document.getElementById('account-login').click();")
    wait(browser, "!document.getElementById('google-connect').disabled")
    browser.script("document.getElementById('google-connect').click();")
    wait(browser, "!document.getElementById('account-signout').hidden&&!document.getElementById('login-dialog').open&&document.querySelector('[data-private-fields]').disabled===false")

def choose_file(browser, target, name='Final CV.pdf'):
    browser.script(target + ";const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4\\nTest document']," + json.dumps(name) + ",{type:'application/pdf'}));const input=document.getElementById('document-file');input.files=dt.files;input.dispatchEvent(new Event('change'));")
    wait(browser, "document.getElementById('upload-message').textContent.includes('uploaded and attached')")

def backup_text(browser):
    browser.script("document.getElementById('backup-progress').click();")
    return async_script(browser, "const done=arguments[arguments.length-1];window.__download.text().then(done);")

b = Browser()
try:
    b.call('WebDriver:SetWindowRect', {'width': 1440, 'height': 1080})
    b.call('WebDriver:Navigate', {'url': 'http://127.0.0.1:8765/all-applications.html'})
    b.script("localStorage.removeItem('ecosapien-google-client-id');localStorage.setItem('ecosapien-all-applications-v1',JSON.stringify({version:1,progress:{'daad-11011':{saved:true,stage:'Preparing',notes:'Private legacy note'}}}));")
    b.call('WebDriver:Refresh')
    b.check('signed-out page hides legacy progress but preserves its browser copy', "return document.getElementById('saved-count').textContent==='0'&&document.querySelector('[data-notes]').value===''&&document.querySelector('[data-private-fields]').hidden&&!document.getElementById('legacy-notice').hidden&&localStorage.getItem('ecosapien-all-applications-v1').includes('Private legacy note');")
    b.check('public research and upload entry points available without login', "return document.querySelectorAll('.programme-card').length===128&&document.querySelectorAll('.my-files-button:not([hidden])').length===128&&document.querySelectorAll('.programme-card:not([hidden])').length===12;")
    b.script("document.getElementById('account-login').click();")
    b.check('missing client ID explained in an accessible login dialog', "return document.getElementById('login-dialog').open&&document.getElementById('google-connect').disabled&&document.getElementById('google-setup').open&&document.getElementById('login-dialog').querySelector('a[href=\"google-drive-setup.html\"]')!==null;")
    b.screenshot('ma-google-login-setup.png')
    fixture(b)
    b.script("document.getElementById('google-client-id').value='123456789012-test-client.apps.googleusercontent.com';document.getElementById('google-config-form').dispatchEvent(new Event('submit',{cancelable:true}));")
    wait(b, "!document.getElementById('google-connect').disabled")
    b.script("document.getElementById('google-connect').click();")
    wait(b, "!document.getElementById('login-dialog').open")
    b.check('login shows actual Google account and unlocks nine shared uploads', "return document.getElementById('account-title').textContent==='account-a@example.test'&&!document.querySelector('[data-private-fields]').disabled&&document.querySelectorAll('[data-library-upload]').length===9;")

    b.script("window.__mock.failSave='before';document.getElementById('import-browser').click();")
    wait(b, "document.getElementById('save-status').textContent.includes('not been confirmed saved')")
    b.check('failed migration retains the only browser copy', "return localStorage.getItem('ecosapien-all-applications-v1').includes('Private legacy note')&&document.querySelector('#route-daad-11011 [data-notes]').value==='Private legacy note';")
    b.script("document.getElementById('import-browser').click();")
    wait(b, "document.getElementById('legacy-notice').hidden")
    b.check('successful migration clears browser plaintext after durable save', "return localStorage.getItem('ecosapien-all-applications-v1')===null&&document.getElementById('saved-count').textContent==='1'&&[...window.__mock.files.values()].some(f=>f.payload?.changes.some(c=>c.value==='Private legacy note'));")

    b.script("document.querySelector('#route-daad-11011 .my-files-button').click();")
    wait(b, "document.querySelectorAll('#route-daad-11011 [data-document-row]').length===9")
    choose_file(b, "document.querySelector('#route-daad-11011 [data-upload=cv]').click()")
    b.check('direct programme upload attaches a private file and marks it ready', "const c=document.getElementById('route-daad-11011');return c.querySelector('[data-document-row=cv] select').value==='Ready'&&c.querySelector('[data-document-row=cv] input').value.startsWith('https://drive.google.com/file/d/')&&c.querySelector('[data-stage]').value==='Preparing'&&c.querySelector('[data-document-count]').textContent.startsWith('1 / 9');")
    choose_file(b, "document.querySelector('[data-library-upload=transcript]').click()", 'Transcript.pdf')
    b.check('shared uploads supply default links to each programme', "return document.getElementById('library-transcript').value===document.querySelector('#route-daad-11011 [data-document-row=transcript] a').href;")
    old_cv=b.script("return document.querySelector('#route-daad-11011 [data-document-row=cv] input').value;")
    choose_file(b, "document.querySelector('#route-daad-11011 [data-upload=cv]').click()", 'Revised CV.pdf')
    b.check('replacement keeps prior file in Drive', "return [...window.__mock.files.values()].filter(f=>f.appProperties?.eco_slot==='cv').length===2;")
    assert old_cv != b.script("return document.querySelector('#route-daad-11011 [data-document-row=cv] input').value;")

    b.script("const n=document.querySelector('#route-daad-11011 [data-notes]');n.value='=HYPERLINK(\"test\") Private test note';n.dispatchEvent(new Event('input'));document.getElementById('sync-drive').click();")
    wait(b, "document.getElementById('save-status').textContent==='Up to date with your Google Drive.'")
    backup=json.loads(backup_text(b))
    assert backup['version']==3 and 'access_token' not in json.dumps(backup)
    assert backup['progress']['daad-11011']['documents']['cv']['status']=='Ready'
    b.check('no new private state or tokens persisted in browser storage', "return Object.keys(localStorage).every(k=>!k.includes('ecosapien-all-applications'))&&JSON.stringify(localStorage).includes('Private test note')===false&&sessionStorage.length===0;")
    b.script("document.querySelector('[data-preset=all]').click();document.getElementById('export-csv').click();")
    csv=async_script(b,"const done=arguments[arguments.length-1];window.__download.text().then(done);")
    assert "'=HYPERLINK" in csv and 'CV status' in csv and 'https://drive.google.com/file/d/' in csv
    print('PASS private backup and CSV include files, escape formulas, exclude credentials',flush=True)

    snapshot=b.script('return window.__mock.export();')
    b.call('WebDriver:Refresh')
    b.check('reload requires Google access before showing private state', "return document.querySelector('[data-notes]').value===''&&document.querySelector('[data-private-fields]').hidden;")
    fixture(b,snapshot)
    login(b)
    b.script("document.querySelector('#route-daad-11011 .my-files-button').click();")
    wait(b,"document.querySelectorAll('#route-daad-11011 [data-document-row]').length===9")
    b.check('new session restores progress and files from Drive', "return document.querySelector('#route-daad-11011 [data-notes]').value.includes('Private test note')&&document.querySelector('#route-daad-11011 [data-document-row=cv] select').value==='Ready';")
    b.script("const input=document.querySelector('#route-daad-11011 [data-document-row=cv] input');input.value='https://drive.google.com.evil.example/file';input.dispatchEvent(new Event('change'));")
    b.check('pasted unsafe links are rejected', "return !document.querySelector('#route-daad-11011 [data-document-row=cv] input').validity.valid;")
    b.script("document.getElementById('sync-drive').click();")
    wait(b,"document.getElementById('save-status').textContent==='Up to date with your Google Drive.'")
    b.script("window.__mock.failAuth=true;document.getElementById('sync-drive').click();")
    wait(b,"!document.getElementById('account-login').hidden&&document.getElementById('account-login').textContent==='Reconnect to Google'")
    b.check('expired token locks writes and keeps a backup available', "return document.querySelector('[data-private-fields]').disabled&&!document.getElementById('backup-progress').hidden;")
    login(b)

    b.script("document.getElementById('document-library').scrollIntoView();")
    b.screenshot('ma-private-drive-desktop.png')
    b.call('WebDriver:SetWindowRect', {'width': 390, 'height': 844})
    b.check('signed-in document shelf fits mobile viewport', "return document.documentElement.scrollWidth<=window.innerWidth;")
    b.script("document.querySelector('#route-daad-11011 .personal-progress').scrollIntoView();")
    b.check('programme upload checklist fits mobile viewport', "return document.documentElement.scrollWidth<=window.innerWidth;")
    b.screenshot('ma-private-drive-mobile.png')

    b.script("document.getElementById('account-signout').click();")
    b.check('sign-out removes every private value and document URL from the page', "return [...document.querySelectorAll('[data-notes],[data-folder],[data-library-document],[data-document-row] input')].every(e=>e.value==='')&&[...document.querySelectorAll('.document-library a,.personal-progress a')].every(e=>!e.hasAttribute('href'))&&document.getElementById('saved-count').textContent==='0'&&document.getElementById('account-title').textContent==='Your private application workspace';")
    b.script("window.__account='account-b';")
    login(b)
    b.check('another account cannot see first account progress', "return document.getElementById('account-title').textContent==='account-b@example.test'&&document.getElementById('saved-count').textContent==='0'&&document.querySelector('#route-daad-11011 [data-notes]').value==='';")
    b.script("document.getElementById('account-signout').click();window.__holdAuth=true;document.getElementById('account-login').click();")
    wait(b,"!document.getElementById('google-connect').disabled")
    b.script("document.getElementById('google-connect').click();document.getElementById('account-signout').click();window.__oauthCallback({access_token:'account-a',expires_in:3600,scope:DriveWorkspace.scope});")
    b.check('late Google callback cannot undo sign-out', "return document.getElementById('account-signout').hidden&&document.querySelector('[data-private-fields]').hidden;")
    b.check('no uncaught errors during private workspace flows', "return window.__errors.length===0;")
    b.script("window.__holdAuth=false;document.getElementById('account-login').click();")
    b.screenshot('ma-google-login-mobile.png')
    b.check('login modal fits mobile viewport', "const d=document.getElementById('login-dialog').getBoundingClientRect();return d.left>=0&&d.right<=innerWidth&&d.height<=innerHeight;")
    b.script("document.getElementById('close-login').click();document.querySelector('[data-preset=all]').click();document.getElementById('show-all').click();")
    b.check('all 128 researched routes still browsable',"return document.querySelectorAll('.programme-card:not([hidden])').length===128;")
    b.script("const i=document.getElementById('intake');i.value='Winter 2026/27';i.dispatchEvent(new Event('change'));")
    b.check('winter deadline finding preserved',"return !document.getElementById('no-results').hidden&&document.getElementById('empty-explanation').textContent.includes('30 September');")
    b.call('WebDriver:Navigate',{'url':(Path(__file__).resolve().parents[2]/'all-applications-offline.html').as_uri()})
    b.check('offline copy filters research and points private work to hosted site', "return !document.getElementById('filters').hidden&&document.querySelectorAll('script[src],link[rel=stylesheet]').length===0&&document.getElementById('account-login').textContent==='Open private workspace'&&document.getElementById('save-status').textContent.includes('Offline research');")
    for page in ('google-drive-setup.html','application-privacy.html','index.html','studio.html','applications.html','404.html'):
        b.call('WebDriver:Navigate',{'url':'http://127.0.0.1:8765/'+page})
        b.check(page+' retains application navigation and fits mobile', "const links=[...document.querySelectorAll('nav a')];return links.some(a=>a.textContent==='Art application')&&links.some(a=>a.textContent==='All applications')&&document.documentElement.scrollWidth<=innerWidth;")
    b.script("localStorage.removeItem('ecosapien-google-client-id');localStorage.removeItem('ecosapien-all-applications-v1');")
    print('All mocked OAuth / Drive browser checks passed. Real Google consent still needs a client ID.',flush=True)
finally:
    b.call('WebDriver:DeleteSession');b.sock.close()
