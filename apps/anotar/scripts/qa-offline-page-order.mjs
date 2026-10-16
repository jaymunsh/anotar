import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { offlineApp, prepareShell, settleSync, waitForAsync } from './fixtures/offline-app.mjs';
const bundle=await build({stdin:{contents:"import * as api from './src/sync/runtime.ts';window.offlineFixture=api;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
const app=await offlineApp();
try{
 const context=await app.browser.newContext(),page=await context.newPage();await page.goto(app.base);await prepareShell(page);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>offlineFixture.getWorkspaceRuntime());await context.setOffline(true);
 const ids=await page.evaluate(async()=>{
  const send=async(path,body,method='POST')=>{const r=await offlineFixture.workspaceFetch(path,{method,body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return (await r.json()).item;};
  const parent=await send('/api/pages',{title:'오프라인 부모'}),child=await send('/api/pages',{title:'오프라인 자식',parentId:parent.id});
  await send('/api/pages/'+parent.id,{title:parent.title,icon:'',document:{schemaVersion:1,blocks:[{id:crypto.randomUUID(),type:'page',props:{pageId:child.id,title:child.title},children:[]}]},expectedVersion:1},'PUT');return {parent:parent.id,child:child.id};
 });
 await context.setOffline(false);await page.evaluate(()=>offlineFixture.requestWorkspaceSync());
 await waitForAsync(page,async({parent,child})=>{const r=await fetch('/api/pages/'+parent);if(!r.ok)return false;const item=(await r.json()).item;return item.document.blocks.some(b=>b.props?.pageId===child);},ids);
 const serverChild=(await(await fetch(app.base+'/api/pages/'+ids.child)).json()).item;assert.equal(serverChild.parentId,ids.parent);
 await page.goto(app.base+'/pages/'+ids.child);await page.getByLabel('페이지 제목',{exact:true}).waitFor();await settleSync(page);
 let release,received;const held=new Promise(r=>release=r),seen=new Promise(r=>received=r);let intercept=true;
 await page.route('**/api/sync/operations',async route=>{if(intercept){intercept=false;const result=await route.fetch();received();await held;await route.fulfill({response:result});}else await route.continue();});
 await page.getByLabel('페이지 제목',{exact:true}).fill('응답 대기 첫 수정');await seen;
 await page.getByLabel('페이지 제목',{exact:true}).fill('응답 대기 최신 수정');await page.getByText('기기에 저장됨',{exact:true}).waitFor();release();
 await waitForAsync(page,async id=>(await(await fetch('/api/pages/'+id)).json()).item.title==='응답 대기 최신 수정',ids.child);assert.equal(await page.getByLabel('페이지 제목',{exact:true}).inputValue(),'응답 대기 최신 수정');await page.unroute('**/api/sync/operations');
 await context.setOffline(true);await page.getByLabel('페이지 제목',{exact:true}).fill('삭제 후에도 보존할 내 문서');await page.getByText('기기에 저장됨',{exact:true}).waitFor();
 const current=(await(await fetch(app.base+'/api/pages/'+ids.child)).json()).item;await app.request('/api/pages/'+ids.child+'/trash',{operationId:crypto.randomUUID(),expectedVersion:current.version});
 await context.setOffline(false);await page.getByRole('button',{name:'동기화 상태',exact:true}).click();await page.getByRole('button',{name:'지금 동기화',exact:true}).click();await page.getByRole('button',{name:'동기화 상태 닫기'}).click();await page.getByText('서버본과 기기본이 달라요',{exact:true}).waitFor();await page.getByRole('button',{name:'변경 내용 비교',exact:true}).click();assert.equal(await page.getByRole('radio',{name:/^내 변경으로 반영/}).isDisabled(),true);assert.equal((await fetch(app.base+'/api/pages/'+ids.child)).status,404);
 console.log('PASS page ordering: offline parent/child/reference dependencies, delayed acknowledgement retains latest revision, delete conflict never resurrects');
}finally{await app.close();}
