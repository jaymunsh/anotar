import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {waitForAsync} from './fixtures/offline-app.mjs';
const bundle=await build({stdin:{contents:"import * as update from './src/offline/update.ts';window.fixture=update;update.registerLocalFlush(async()=>{await new Promise(r=>setTimeout(r,60));localStorage.setItem('retainedDraft',document.querySelector('textarea').value);});",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
const worker=await readFile('public/capture-worker.js','utf8'),captureStore=await readFile('public/capture-store.js');let version='v1',fail=false;
const index=()=>Buffer.from('<textarea aria-label="draft"></textarea><script src="/assets/fixture.js"></script>');const js=()=>Buffer.from(bundle.outputFiles[0].text+`;window.buildVersion='${version}';`);
const server=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/capture-worker.js'){res.setHeader('Content-Type','application/javascript');res.end(worker.replace('__LENEU_OFFLINE_VERSION__',version));}else if(req.url==='/capture-store.js'){res.setHeader('Content-Type','application/javascript');res.end(captureStore);}else if(req.url==='/offline-manifest.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({appVersion:version,assets:[{url:'/index.html',hash:createHash('sha256').update(index()).digest('hex')},{url:'/assets/fixture.js',hash:fail?'0'.repeat(64):createHash('sha256').update(js()).digest('hex')}]}));}else if(req.url==='/assets/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(js());}else{res.setHeader('Content-Type','text/html');res.end(index());}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const context=await browser.newContext(),page=await context.newPage();await page.goto(base);await page.evaluate(async()=>{await navigator.serviceWorker.register('/capture-worker.js',{type:'module',scope:'/'});await navigator.serviceWorker.ready;});await page.reload();assert.equal(await page.evaluate(()=>window.buildVersion),'v1');
 version='v2';fail=true;await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');await r.update();});await waitForAsync(page,async()=>{const r=await navigator.serviceWorker.getRegistration('/');return !r.installing;});
 assert.ok(!(await page.evaluate(()=>caches.keys())).some(name=>name.endsWith('v2')));assert.equal(await page.evaluate(()=>window.buildVersion),'v1');
 fail=false;await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');await r.update();});await waitForAsync(page,async()=>!!(await navigator.serviceWorker.getRegistration('/')).waiting);
 // Poll a synchronous flag: waitForFunction treats an unresolved Promise as truthy on this Playwright version.
 for(let i=0;i<100;i++){if(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration('/')).waiting))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration('/')).waiting),true);
 await page.getByLabel('draft').fill('업데이트 직전의 한글 초안');await Promise.all([page.waitForEvent('framenavigated'),page.evaluate(()=>fixture.activatePreparedUpdate())]);await page.waitForFunction(()=>window.buildVersion==='v2');assert.equal(await page.evaluate(()=>localStorage.getItem('retainedDraft')),'업데이트 직전의 한글 초안');
 await context.setOffline(true);await page.reload();assert.equal(await page.evaluate(()=>window.buildVersion),'v2');assert.ok((await page.evaluate(()=>caches.keys())).some(name=>name.endsWith('v1')));
 console.log('PASS SW update: failed v2 keeps ready v1, successful v2 waits, local flusher completes before activation/reload, v2 offline relaunch, old cache retained');
}finally{await browser.close();await new Promise(r=>server.close(r));}
