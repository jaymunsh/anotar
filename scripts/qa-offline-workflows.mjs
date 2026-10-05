import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { offlineApp,prepareShell } from './fixtures/offline-app.mjs';
const bundle=await build({stdin:{contents:"import * as api from './src/sync/runtime.ts';import * as workflows from './src/sync/workflows.ts';import * as repo from './src/sync/repository.ts';window.fixture={...api,...workflows,...repo};",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
const app=await offlineApp();
async function poll(check){const deadline=Date.now()+45000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('서버 상태 확인 시간 초과');}
try {
 const context=await app.browser.newContext(),page=await context.newPage();await page.goto(app.base);await prepareShell(page);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>fixture.getWorkspaceRuntime());await context.setOffline(true);
 const ids=await page.evaluate(async()=>{
  const form=new FormData();form.set('kind','note');form.set('text','기기에서 작성한 여행 조사');form.set('requestId',crypto.randomUUID());form.set('aiRequest',JSON.stringify({template:null,additional:'교통 조사'}));
  const response=await fixture.workspaceFetch('/api/captures',{method:'POST',body:form});if(!response.ok)throw Error(await response.text());const item=(await response.json()).item;
  const r=await fixture.getWorkspaceRuntime();let queue=await fixture.listRecords('outbox',r.workspaceId,50);const ai=queue.find(p=>p.operation.kind==='ai.submit');if(!ai)throw Error('AI가 기기에 저장되지 않았어요.');
  if(ai.dependencies.length!==1)throw Error('새 원본의 저장 의존성이 없어요.');
  await fixture.cancelQueuedWorkflow(ai.operation.operationId);
  const edit=await fixture.workspaceFetch('/api/captures/'+item.id,{method:'PUT',body:JSON.stringify({text:'최신 로컬 내용',url:null,expectedVersion:1})});if(!edit.ok)throw Error(await edit.text());
  const organizeId=crypto.randomUUID();await fixture.queueWorkflow('capture.organize','capture',item.id,organizeId,{copyContent:true,assetIds:[],target:{newPageId:crypto.randomUUID(),title:'오프라인 정리',parentId:null}});
  queue=await fixture.listRecords('outbox',r.workspaceId,50);if(queue.filter(p=>/capture\.(create|update)/.test(p.operation.kind)).length!==2)throw Error('요청 시 최신 원본을 고정하지 않았어요.');
  return {source:item.id,organizeId};
 });
 assert.equal((await(await fetch(app.base+'/api/captures')).json()).items.length,0);
 await context.setOffline(false);await page.evaluate(()=>fixture.requestWorkspaceSync());
 await poll(async()=>{const r=await fetch(app.base+'/api/captures/'+ids.source);return r.ok&&!!(await r.json()).item.organizedAt;});
 const source=(await(await fetch(app.base+'/api/captures/'+ids.source)).json()).item;if(source?.text!=='최신 로컬 내용'){console.log(JSON.stringify(await page.evaluate(async()=>{const r=await fixture.getWorkspaceRuntime();return {queue:await fixture.listRecords('outbox',r.workspaceId,50),entities:await fixture.listRecords('entities',r.workspaceId,50)};})));}assert.equal(source.text,'최신 로컬 내용');
 const target=(await(await fetch(app.base+'/api/pages/'+source.organizedPageId)).json()).item;assert.ok(JSON.stringify(target.document).includes('최신 로컬 내용'));
 await context.setOffline(true);
 await page.evaluate(async id=>{const r=await fixture.getWorkspaceRuntime();const source=await fixture.readLocalEntity({workspaceId:r.workspaceId,kind:'capture',id});await fixture.queueWorkflow('ai.submit','capture',id,crypto.randomUUID(),{request:{template:null,additional:'고정 요청'}});},ids.source);
 await page.goto(app.base+'/ai');await page.getByLabel('기기에서 전송 대기').waitFor();assert.ok((await page.getByLabel('기기에서 전송 대기').textContent()).includes('AI 요청'));
 await context.setOffline(false);await page.getByRole('button',{name:'동기화 상태',exact:true}).click();await page.getByRole('button',{name:'지금 동기화',exact:true}).click();
 await poll(async()=>{const r=await fetch(app.base+'/api/captures/'+ids.source+'/ai-jobs');return r.ok&&(await r.json()).items.length===1;});
 console.log('PASS workflows: offline capture+AI dependency, safe preflight cancel, frozen newer source chain, atomic organization, monitoring and reconnect creates one AI job');
} finally {await app.close();}
