import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {build} from 'esbuild';
import {offlineApp,prepareShell} from './fixtures/offline-app.mjs';
const bundled=await build({stdin:{contents:"import * as api from './src/sync/runtime.ts';import * as recovery from './src/offline/recovery.ts';import * as exp from './src/offline/exportPending.ts';import * as repo from './src/sync/repository.ts';import * as storage from './src/offline/storage.ts';window.fixture={...api,...recovery,...exp,...repo,...storage};",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
function readZip(bytes){const entries=new Map();let offset=0;while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),nameSize=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),name=bytes.subarray(offset+30,offset+30+nameSize).toString(),start=offset+30+nameSize+extra;entries.set(name,bytes.subarray(start,start+size));offset=start+size;}return entries;}
const app=await offlineApp();
try {
 const original=(await app.request('/api/pages',{title:'복구할 페이지'})).item;
 const context=await app.browser.newContext(),page=await context.newPage();await page.goto(app.base+'/pages/'+original.id);await prepareShell(page);await page.getByLabel('페이지 제목',{exact:true}).waitFor();await page.addScriptTag({content:bundled.outputFiles[0].text});await page.evaluate(()=>fixture.getWorkspaceRuntime());await context.setOffline(true);
 await page.evaluate(async id=>{
  const form=new FormData();form.set('kind','file');form.set('text','내보낼 미전송 원문');form.append('files',new File(['원본 첨부 바이트'],'기기.txt',{type:'text/plain'}));
  const r=await fixture.workspaceFetch('/api/captures',{method:'POST',body:form});if(!r.ok)throw Error(await r.text());
  await fixture.workspaceFetch('/api/pages/'+id,{method:'PUT',body:JSON.stringify({expectedVersion:1,title:'복원 뒤 확인할 기기 변경',icon:'',document:{schemaVersion:1,blocks:[{id:crypto.randomUUID(),type:'paragraph',props:{},content:[{type:'text',text:'기기에 보존할 내용',styles:{}}],children:[]}]}})});
  const runtime=await fixture.getWorkspaceRuntime();if(await fixture.canResetLocalWorkspace(runtime.workspaceId))throw Error('미전송 자료가 있는데 초기화를 허용함');
 },original.id);
 const db=new DatabaseSync(join(app.dir,'storage.sqlite'));const old=db.prepare('SELECT epoch FROM sync_meta').get().epoch;db.prepare('UPDATE sync_meta SET epoch=?').run(randomUUID());db.close();
 await context.setOffline(false);await page.evaluate(()=>fixture.requestWorkspaceSync());
 await page.waitForFunction(()=>fixture.getSyncSnapshot().state==='recovery',null,{timeout:45000});
 const held=await page.evaluate(async()=>{const runtime=await fixture.getWorkspaceRuntime();return {state:fixture.getSyncSnapshot().state,pending:(await fixture.listRecords('outbox',runtime.workspaceId,100)).length};});assert.equal(held.state,'recovery');assert.equal(held.pending,2);
 await assert.rejects(page.evaluate(()=>fixture.reconnectAfterReview({reviewed:true})),/내보내/);
 const exported=await page.evaluate(async()=>{const {workspaceId}=await fixture.getWorkspaceRuntime();const result=await fixture.exportPendingWorkspace(workspaceId);return {bytes:Array.from(new Uint8Array(await result.blob.arrayBuffer())),manifest:result.manifest};});
 const zip=readZip(Buffer.from(exported.bytes)),manifest=JSON.parse(zip.get('manifest.json').toString());assert.equal(manifest.outbox.length,2);assert.ok(JSON.stringify(manifest).includes('내보낼 미전송 원문'));assert.equal(zip.get(manifest.files[0].path).toString(),'원본 첨부 바이트');assert.equal(createHash('sha256').update(zip.get(manifest.files[0].path)).digest('hex'),manifest.files[0].hash);
 await page.evaluate(async id=>{const data=await fixture.recoveryOverview();const selectedKeys=data.entities.filter(e=>e.id===id).map(e=>e.key);if(!selectedKeys.length)throw Error('선택할 기기 페이지 변경 없음');const result=await fixture.reconnectAfterReview({reviewed:true,selectedKeys});if(result.retained!==1)throw Error('선택이 적용되지 않음');},original.id);
 await page.reload();await page.getByLabel('페이지 제목',{exact:true}).waitFor();
 for(let i=0;i<450;i++){const item=(await(await fetch(app.base+'/api/pages/'+original.id)).json()).item;if(item.title==='복원 뒤 확인할 기기 변경')break;await new Promise(r=>setTimeout(r,100));}
 if((await(await fetch(app.base+'/api/pages/'+original.id)).json()).item.title!=='복원 뒤 확인할 기기 변경'){await page.addScriptTag({content:bundled.outputFiles[0].text});console.log(await page.evaluate(async()=>{const r=await fixture.getWorkspaceRuntime();return {state:fixture.getSyncSnapshot(),queue:await fixture.listRecords('outbox',r.workspaceId,20)};}));}assert.equal((await(await fetch(app.base+'/api/pages/'+original.id)).json()).item.title,'복원 뒤 확인할 기기 변경');
 await page.addScriptTag({content:bundled.outputFiles[0].text});const archived=await page.evaluate(async()=>{const {workspaceId}=await fixture.getWorkspaceRuntime();return (await fixture.listRecords('meta',workspaceId,1000)).filter(v=>v.entities&&v.outbox);});assert.ok(archived.some(a=>JSON.stringify(a).includes('내보낼 미전송 원문')));
 assert.notEqual((await(await fetch(app.base+'/api/sync/session')).json()).epoch,old);
 await context.setOffline(true);
 const previousWorkspace=await page.evaluate(async()=>{const runtime=await fixture.getWorkspaceRuntime();const form=new FormData();form.set('kind','note');form.set('text','다른 작업 공간에 자동 전송하지 않을 원문');await fixture.workspaceFetch('/api/captures',{method:'POST',body:form});await fixture.exportPendingWorkspace(runtime.workspaceId);return runtime.workspaceId;});
 const otherId=randomUUID(),otherDb=new DatabaseSync(join(app.dir,'storage.sqlite'));otherDb.prepare('UPDATE sync_meta SET workspace_id=?,epoch=?').run(otherId,randomUUID());otherDb.close();
 await context.setOffline(false);await page.evaluate(()=>fixture.requestWorkspaceSync());await page.waitForFunction(()=>fixture.getSyncSnapshot().state==='recovery',null,{timeout:45000});
 await page.evaluate(()=>fixture.reconnectAfterReview({reviewed:true}));await page.reload();await page.addScriptTag({content:bundled.outputFiles[0].text});
 const partition=await page.evaluate(async old=>{const runtime=await fixture.getWorkspaceRuntime();return {id:runtime.workspaceId,active:await fixture.listRecords('outbox',runtime.workspaceId,100),old:await fixture.listRecords('outbox',old,100)};},previousWorkspace);
 assert.equal(partition.id,otherId);assert.equal(partition.active.length,0);assert.equal(partition.old.length,1);
 const serverMemos=(await(await fetch(app.base+'/api/captures')).json()).items;assert.ok(!serverMemos.some(item=>item.text==='다른 작업 공간에 자동 전송하지 않을 원문'));
 console.log('PASS recovery: epoch pauses unsent operations, reset/export guard, valid ZIP exact text and binary SHA256, explicit selected change gets a fresh operation, old snapshots stay archived, workspace switch preserves old partition without replay');
} finally {await app.close();}
