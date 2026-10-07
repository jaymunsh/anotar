import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {offlineApp} from './fixtures/offline-app.mjs';
import {openStore} from '../server/store.mjs';
import {randomUUID} from 'node:crypto';
const app=await offlineApp();
const document=text=>({schemaVersion:1,blocks:[{id:'remote-paragraph',type:'paragraph',props:{},content:[{type:'text',text,styles:{}}],children:[]}]});
const evidence='.omo/evidence/page-remote-refresh';await mkdir(evidence,{recursive:true});
try{
 const store=openStore(app.dir);const initial=store.createPage({title:'초기 문서',document:document('초기 본문')});store.close();
 const page=await app.browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.base+'/pages/'+initial.id);await page.locator('.page-title-input').waitFor();
 async function current(){return (await(await fetch(app.base+'/api/pages/'+initial.id)).json()).item;}
 async function update(title,text){const p=await current();return app.request('/api/pages/'+initial.id,{title,icon:'📘',document:document(text),expectedVersion:p.version},'PUT');}
 async function sync(){await page.getByRole('button',{name:'동기화 상태',exact:true}).click();await page.getByRole('button',{name:'지금 동기화',exact:true}).click();await page.getByRole('button',{name:'동기화 상태 닫기',exact:true}).click();}
 await sync();
 await update('서버에서 갱신','갱신된 본문');await sync();
 await page.waitForFunction(()=>document.querySelector('.page-title-input')?.value==='서버에서 갱신');
 await page.waitForFunction(()=>document.querySelector('.page-block-editor')?.textContent.includes('갱신된 본문'));
 assert.equal(await page.locator('.sync-conflict').count(),0);
 await page.locator('.page-title-input').fill('갱신 후 수정');
 await sync();
 for(let i=0;i<100;i++){if((await current()).title==='갱신 후 수정')break;if(i===99)throw Error('Updated editor did not save against new server version');await new Promise(r=>setTimeout(r,100));}
 await page.context().setOffline(true);
 await page.locator('.page-title-input').fill('기기에 남긴 변경');
 // A DOM edit precedes the 250ms durable commit. Wait for IDB to retain it.
 await page.waitForFunction(async(id)=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('leneu-offline-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const rows=await new Promise((resolve,reject)=>{const r=db.transaction('entities').objectStore('entities').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return rows.some(e=>e.id===id&&e.current?.title==='기기에 남긴 변경'&&e.dirty);},initial.id);
 await update('경합한 서버 문서','서버 경합 내용');
 await page.context().setOffline(false);await sync();
 try { await page.locator('.sync-conflict').waitFor(); } catch(error) {
 console.log('server',await current());console.log('body',(await page.locator('body').innerText()).slice(0,3500));
 console.log('idb',await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('leneu-offline-v1');r.onsuccess=()=>resolve(r.result);});const output={};for(const key of ['entities','outbox','conflicts'])output[key]=await new Promise(resolve=>{const r=db.transaction(key).objectStore(key).getAll();r.onsuccess=()=>resolve(r.result);});db.close();return output;}));throw error; }

 assert.equal(await page.locator('.page-title-input').inputValue(),'기기에 남긴 변경');
 await page.getByRole('button',{name:'변경 내용 비교',exact:true}).click();assert.ok((await page.locator('.sync-conflict').textContent()).includes('기기에 남긴 변경'));
 assert.ok((await page.locator('.sync-conflict').textContent()).includes('경합한 서버 문서'));
 assert.ok((await page.locator('.sync-conflict').textContent()).includes('서버본과 기기본이 달라요'));
 await page.screenshot({path:evidence+'/conflict-copies.png'});
 await page.getByRole('radio',{name:/^서버 내용 사용/}).check();await page.getByRole('button',{name:'선택한 내용 적용',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.page-title-input')?.value==='경합한 서버 문서');assert.equal(await page.locator('.sync-conflict').count(),0);
 assert.deepEqual(errors,[]);await writeFile(evidence+'/RESULT.json',JSON.stringify({cleanRemoteRefresh:true,editAfterRefresh:true,concurrentEditPreserved:true,conflictResolution:true,errors},null,2));
 console.log('PASS clean server refresh, save after refresh, concurrent copies, conflict resolution');
}finally{await app.close();}
