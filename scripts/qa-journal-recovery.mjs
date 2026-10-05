import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';
const bundle=await build({stdin:{contents:"import * as runtime from './src/sync/runtime.ts';import * as repo from './src/sync/repository.ts';import * as recovery from './src/offline/recovery.ts';import * as exporter from './src/offline/exportPending.ts';import * as journal from './shared/journal.mjs';window.fixture={...runtime,...repo,...recovery,...exporter,...journal};",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
const app=await offlineApp();
try {
 const context=await app.browser.newContext(),page=await context.newPage();await page.goto(app.base+'/journal');await page.locator('#daySheet .day-hour').last().waitFor();await prepareShell(page);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>fixture.getWorkspaceRuntime());
 await context.setOffline(true);
 const saved=await page.evaluate(async()=>{
  const {workspaceId}=await fixture.getWorkspaceRuntime(),date='2026-08-13',id=fixture.journalId(workspaceId,date);
  const day=fixture.normalizeJournalDay({priorities:[{text:'복구할 우선순위',done:true}],brain:'',idea:'',feedback:'복구 후에도 지킬 회고',plan:[{id:'recover-plan',start:1380,end:1440,title:'불변 계획 사본',kind:'meeting',note:'이전 메모',missed:true,priorityId:'legacy-2026-08-13-0',priorityDate:date,priorityTitle:'복구할 우선순위',sourcePlan:{date:'2026-08-12',id:'old-plan'}}],actual:[{id:'hidden',start:0,end:10,title:'숨긴 옛 실제 기록',kind:'life',note:''}]},date);
  await fixture.queueValue('journal',id,{id,date,day,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  return {workspaceId,id,date,day};
 });
 const db=new DatabaseSync(join(app.dir,'storage.sqlite'));db.prepare('UPDATE sync_meta SET epoch=?').run(randomUUID());db.close();
 await context.setOffline(false);await page.evaluate(()=>fixture.requestWorkspaceSync());await page.waitForFunction(()=>fixture.getSyncSnapshot().state==='recovery');
 await assert.rejects(page.evaluate(()=>fixture.reconnectAfterReview({reviewed:true})),/내보내/);
 const manifest=await page.evaluate(async()=>{const {workspaceId}=await fixture.getWorkspaceRuntime();return(await fixture.exportPendingWorkspace(workspaceId)).manifest;});
 assert.deepEqual(manifest.entities.find(e=>e.id===saved.id).current.day,saved.day);
 await page.evaluate(async id=>{const overview=await fixture.recoveryOverview(),selectedKeys=overview.entities.filter(e=>e.id===id).map(e=>e.key);const result=await fixture.reconnectAfterReview({reviewed:true,selectedKeys});if(result.retained!==1)throw Error('journal recovery selection lost');},saved.id);
 let recovered;
 for(let i=0;i<100;i++){recovered=(await(await fetch(app.base+'/api/sync/entities/journal/'+saved.id)).json()).item;if(recovered)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(recovered);assert.equal(recovered.id,saved.id);assert.equal(recovered.date,saved.date);assert.deepEqual(recovered.day,saved.day);
 const archive=await page.evaluate(async()=>{const {workspaceId}=await fixture.getWorkspaceRuntime();return(await fixture.listRecords('meta',workspaceId,1000)).filter(m=>m.entities&&m.outbox);});assert.ok(archive.some(m=>m.entities.some(e=>e.id===saved.id)));
 await mkdir('.omo/evidence/journal-sync',{recursive:true});await writeFile('.omo/evidence/journal-sync/recovery.json',JSON.stringify({status:'PASS',checks:['epoch rotation pauses journal upload','recovery requires latest export before clearing cache','selected journal recovery retains deterministic date identity and complete linked/missed/hidden-actual JSON','previous copies and pending operation remain in recovery archive']},null,2));
 console.log('PASS journal recovery: epoch pause, export guard, selected restore retains date ID and exact JSON, previous archive');
}finally{await app.close();}
