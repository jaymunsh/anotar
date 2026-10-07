import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { offlineApp } from './fixtures/offline-app.mjs';
import { openStore } from '../server/store.mjs';
import { ensureArchitecturePage } from './seed-architecture.mjs';
const app = await offlineApp();
let publicServer;
const evidence='.omo/evidence/document-presentation';
await mkdir(evidence,{recursive:true});
try {
 const store=openStore(app.dir); const doc=await ensureArchitecturePage(store); const share=store.createPageShare(doc.id,{expiresInDays:null}); store.close();
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port;await new Promise(r=>probe.close(r));
 publicServer=spawn(process.execPath,['server/public.mjs'],{env:{...process.env,DATA_DIR:app.dir,PUBLIC_PORT:String(port),PUBLIC_HOST:'127.0.0.1'},stdio:'ignore'});
 const publicBase=`http://127.0.0.1:${port}`;
 const token=share.token; assert.ok(token);
 for(let i=0;i<100;i++){try{if((await fetch(publicBase+'/s/'+token)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const errors=[]; const external=[];
 const page=await app.browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.goto(app.base+'/pages/'+doc.id);
 await page.waitForFunction(()=>document.querySelectorAll('.diagram-preview svg').length===4,{},{timeout:45000});
 await page.screenshot({path:evidence+'/private-desktop.png',fullPage:true});
 const privateFont=await page.locator('.page-document').evaluate(e=>getComputedStyle(e).fontFamily);
 const first=page.locator('.diagram-editor').first(); await first.getByRole('button',{name:'소스 수정'}).click();
 const source=first.locator('code[aria-label="Mermaid 소스"]'); await source.waitFor({state:'visible'});
 const oldSource=await source.textContent();
 const replacement='flowchart LR\n A[수정 확인] --> B[저장 확인]';
 // BlockNote's source popup implements Mod-a as select-this-source, with a
 // ProseMirror transaction; DOM Range/fill bypasses that selection contract.
 await source.click();
 await page.keyboard.press('ControlOrMeta+a');
 assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),oldSource);
 // Enter must travel through the source block's hard-break key handler.
 // Chromium insertText with a multiline string normalizes away its newline.
 await page.keyboard.insertText('flowchart LR');
 await page.keyboard.press('Enter');
 await page.keyboard.insertText(' A[수정 확인] --> B[저장 확인]');
 await page.waitForFunction(expected=>document.querySelector('code[aria-label="Mermaid 소스"]')?.textContent===expected,replacement);
 await first.locator('.bn-code-block-source-popup-ok-button').click();

 await page.waitForFunction(()=>document.querySelector('.diagram-preview svg')?.textContent.includes('수정 확인'));
 await first.getByRole('button',{name:'소스 수정'}).click(); await source.click();await page.keyboard.press('ControlOrMeta+z');
 await page.waitForFunction(original=>document.querySelector('code[aria-label="Mermaid 소스"]')?.textContent===original,oldSource);
 await first.locator('.bn-code-block-source-popup-ok-button').click();
 await page.waitForFunction(()=>document.querySelectorAll('.diagram-preview svg').length===4);
 await page.goto(publicBase+'/s/'+token);
 await page.waitForFunction(()=>document.querySelectorAll('[data-diagram-state="ready"]').length===4,{},{timeout:45000});
 const sharedFont=await page.locator('main.shared-document').evaluate(e=>getComputedStyle(e).fontFamily); assert.equal(sharedFont,privateFont);
 await page.screenshot({path:evidence+'/shared-desktop.png',fullPage:true});
 const expand=page.getByRole('button',{name:'확대 보기'}).first();await expand.click(); await page.locator('dialog[open]').waitFor();
 await page.screenshot({path:evidence+'/diagram-expanded.png'});await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 assert.ok(await expand.evaluate(e=>e===document.activeElement));
 for(const width of [390])for(const colorScheme of ['light','dark']){
 await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme});
 await page.screenshot({path:evidence+`/shared-${width}-${colorScheme}.png`,fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(evidence+'/result.json',JSON.stringify({diagrams:4,sourceEdit:true,undo:true,sharedFontsMatch:true,mobileOverflow:false,errors,external},null,2));
 console.log('Document browser QA passed');
} finally {if(publicServer){publicServer.kill();await new Promise(r=>publicServer.exitCode!==null?r():publicServer.once('exit',r));}await app.close();}
