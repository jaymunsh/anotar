import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, operation } from './fixtures/sync.mjs';
import { applySyncOperation } from '../server/sync/operations.mjs';
import { syncDatabase } from '../server/sync/store.mjs';
const selection = {template:null,additional:'핵심만 조사해 주세요.'};
const proof = (item) => ({text:item.text,url:item.url});
test('organize depends on a saved source and receipt replay creates one page and one origin',async t=>{
 const store=await fixture(t), create=operation(store), id=randomUUID();
 const organize={...create,kind:'capture.organize',operationId:id,baseVersion:1,payload:{requestId:id,sourceOperationId:create.operationId,sourceSnapshot:{text:create.payload.text,url:null},target:{newPageId:randomUUID(),title:'정리 문서',parentId:null},copyContent:true,assetIds:[]}};
 assert.throws(()=>applySyncOperation(store,organize),e=>e.code==='dependency_missing');
 applySyncOperation(store,create);
 const first=applySyncOperation(store,organize);
 for(let i=0;i<5;i++)assert.equal(applySyncOperation(store,organize).workflow.item.id,first.workflow.item.id);
 assert.equal(store.getCapture(create.entityId).organizedPageId,first.workflow.item.id);
 assert.equal(syncDatabase(store).prepare('SELECT count(*) n FROM page_origins').get().n,1);
 assert.equal(store.listPages().length,1);
});
test('organize rejects changed target or source without hiding the memo',async t=>{
 const store=await fixture(t), create=operation(store);const source=applySyncOperation(store,create).item;
 const page=store.createPage({title:'대상'});store.updatePage({...page,title:'원격 편집',expectedVersion:1});
 const id=randomUUID(), op={...create,kind:'capture.organize',operationId:id,baseVersion:1,payload:{requestId:id,sourceSnapshot:proof(source),target:{pageId:page.id,expectedVersion:1},copyContent:true,assetIds:[]}};
 assert.throws(()=>applySyncOperation(store,op),e=>e.code==='target_conflict');
 assert.equal(store.getCapture(source.id).organizedAt,null);
 store.updateCapture({id:source.id,text:'원격 수정',url:null,expectedVersion:1});
 assert.throws(()=>applySyncOperation(store,{...op,operationId:randomUUID()}),e=>e.code==='version_conflict');
});
test('AI queues one immutable job; a preceding local save binds the receipt version',async t=>{
 const store=await fixture(t), create=operation(store);const original=applySyncOperation(store,create).item;
 const edit={...create,operationId:randomUUID(),kind:'capture.update',baseVersion:1,payload:{text:'새 입력',url:null}};
 applySyncOperation(store,edit);
 const id=randomUUID(), ai={...create,operationId:id,kind:'ai.submit',baseVersion:1,payload:{requestId:id,sourceKind:'capture',sourceOperationId:edit.operationId,sourceSnapshot:{text:'새 입력',url:null},request:selection}};
 const job=applySyncOperation(store,ai).workflow.item;
 for(let i=0;i<5;i++)assert.equal(applySyncOperation(store,ai).workflow.item.id,job.id);
 assert.equal(store.listAiJobs(original.id).length,1);assert.equal(job.sourceVersion,2);assert.equal(job.request.input.content,'새 입력');
 assert.throws(()=>applySyncOperation(store,{...ai,payload:{...ai.payload,request:{...selection,additional:'다른 지시'}}}),e=>e.code==='payload_mismatch');
 assert.equal(store.getCapture(original.id).version,2);
});
test('AI preserves template revision and refuses remote changes to the frozen source',async t=>{
 const store=await fixture(t), create=operation(store);const item=applySyncOperation(store,create).item;
 const template={id:'cached-template',name:'조사',description:'',archived:false,kind:'research',body:'{{content}} 관련 조사',version:1,revisionId:randomUUID()};
 const id=randomUUID(), ai={...create,operationId:id,kind:'ai.submit',baseVersion:1,payload:{requestId:id,sourceKind:'capture',sourceSnapshot:proof(item),request:{template,additional:''}}};
 const job=applySyncOperation(store,ai).workflow.item;
 assert.equal(job.request.template.body,template.body);assert.equal(job.request.template.revisionId,template.revisionId);
 store.updateCapture({id:item.id,text:'외부 수정',url:null,expectedVersion:1});
 assert.throws(()=>applySyncOperation(store,{...ai,operationId:randomUUID()}),e=>e.code==='version_conflict');
});
