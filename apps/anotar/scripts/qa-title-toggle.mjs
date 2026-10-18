import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {qaApp} from './fixtures/qa-app.mjs';
import {openStore} from '../server/store.mjs';
import {ensureArchitecturePage} from './seed-architecture.mjs';
const app=await qaApp();
// 공유 토글은 공개 서버에서만 렌더된다. 이 스크립트는 전용 포트 8791에 공개 서버를 띄워 실제 공유 링크를 만든다.
const PUBLIC_PORT=8791;
let publicServer;
try{
 const store=openStore(app.dir);const doc=await ensureArchitecturePage(store);const share=store.createPageShare(doc.id,{expiresInDays:null});store.close();
 publicServer=spawn(process.execPath,['server/public.mjs'],{env:{...process.env,DATA_DIR:app.dir,PUBLIC_HOST:'127.0.0.1',PUBLIC_PORT:String(PUBLIC_PORT)},stdio:'ignore'});
 const publicBase=`http://127.0.0.1:${PUBLIC_PORT}`;
 for(let i=0;i<100;i++){try{if((await fetch(publicBase+'/s/'+share.token)).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 const page=await app.browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(app.base+'/pages/'+doc.id);
 await page.locator('.page-title-input').waitFor();
 await page.waitForFunction(t=>document.title===t,doc.title+' | anotar');
 const title=page.locator('.page-title-input');await title.fill('제목 확인');await page.waitForFunction(()=>document.title==='제목 확인 | anotar');
 await title.fill('');await page.waitForFunction(()=>document.title==='anotar | 나만의 워크스페이스');
 await title.fill(doc.title);
 const toggle=page.locator('.bn-block').filter({has:page.locator(':scope > .bn-block-content[data-content-type="toggleListItem"]')}).first();
 console.log('toggle count',await toggle.count());
 assert.equal(await toggle.evaluate(e=>getComputedStyle(e).borderTopStyle),'dotted');
 assert.equal(await toggle.evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');
 await toggle.locator('.bn-toggle-button').click();
 await mkdir('.omo/evidence/title-toggle',{recursive:true});
 await toggle.screenshot({path:'.omo/evidence/title-toggle/toggle-open.png'});
 await page.goto(app.base+'/');await page.waitForFunction(()=>document.title==='anotar | 나만의 워크스페이스');
 await page.goto(publicBase+'/s/'+share.token);
 await page.waitForFunction(()=>document.title.endsWith(' | anotar'));
 const shared=page.locator('.page-reference-toggle').first();assert.equal(await shared.evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');assert.equal(await shared.evaluate(e=>getComputedStyle(e).borderTopStyle),'dotted');await shared.locator('> summary').click();assert.equal(await shared.getAttribute('open'),'');
 await shared.screenshot({path:'.omo/evidence/title-toggle/shared-toggle-open.png'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await shared.screenshot({path:'.omo/evidence/title-toggle/shared-mobile-dark.png'});
 console.log('PASS: title edits, fallback navigation, private/shared dotted toggles, mobile width');
}finally{if(publicServer){publicServer.kill();if(publicServer.exitCode===null)await new Promise(r=>publicServer.once('exit',r));}await app.close();}
