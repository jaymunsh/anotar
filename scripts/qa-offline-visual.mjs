import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {offlineApp,prepareShell} from './fixtures/offline-app.mjs';
const bundle=await build({stdin:{contents:"import * as runtime from './src/sync/runtime.ts';import * as repo from './src/sync/repository.ts';window.fixture={...runtime,...repo};",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
const app=await offlineApp(),dir='.omo/evidence/offline-workspace/screenshots';await mkdir(dir,{recursive:true});
async function screenshots(page,state){for(const width of [1440,390,320])for(const mode of ['light','dark']){await page.setViewportSize({width,height:900});await page.evaluate(mode=>{document.documentElement.dataset.theme=mode;},mode);await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),state+' '+width+' overflow');await page.screenshot({path:`${dir}/${state}-${width}-${mode}.png`});}}
try {
 const first=(await app.request('/api/pages',{title:'오프라인 상태 확인 문서'})).item,uncached=(await app.request('/api/pages',{title:'미보관 문서'})).item;
 const ctx=await app.browser.newContext(),page=await ctx.newPage();await page.goto(app.base+'/pages/'+first.id);await page.getByLabel('페이지 제목',{exact:true}).waitFor();await prepareShell(page);await ctx.setOffline(true);
 await page.getByLabel('페이지 제목',{exact:true}).fill('오프라인에서도 계속 작성하는 문서');await page.getByText('기기에 저장됨',{exact:true}).waitFor();await screenshots(page,'pending');
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='entities')throw new DOMException('full','QuotaExceededError');return originalPut.call(this,value,...args);};});
 await page.getByLabel('페이지 제목',{exact:true}).fill('용량 부족이어도 입력은 그대로 유지');await page.getByText('기기 저장 공간이 부족해요.',{exact:false}).waitFor();assert.equal(await page.getByLabel('페이지 제목',{exact:true}).inputValue(),'용량 부족이어도 입력은 그대로 유지');await screenshots(page,'quota');await page.evaluate(()=>{IDBObjectStore.prototype.put=originalPut;});
 await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(async id=>{const {workspaceId}=await fixture.getWorkspaceRuntime();const entity=await fixture.readLocalEntity({workspaceId,kind:'page',id});const operationId=crypto.randomUUID();await fixture.writeRecord('conflicts',workspaceId,[operationId],{operationId,entityKind:'page',entityId:id,base:entity.base,local:entity.current,server:{...entity.base,title:'서버에서 바꾼 제목',version:2},tombstone:false});},first.id);
 await page.getByText('다른 기기에서 수정했어요',{exact:true}).waitFor();await screenshots(page,'conflict');
 await page.goto(app.base+'/pages/'+uncached.id);await page.getByText('이 기기에 보관하지 않은 페이지예요.',{exact:false}).waitFor();await screenshots(page,'uncached');
 console.log('PASS visual: 24 captures, 1440/390/320 light/dark pending/conflict/quota/uncached, retained quota input, no horizontal overflow');
}finally{await app.close();}
