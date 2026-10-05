import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, operation } from './fixtures/sync.mjs';
import { applySyncOperation } from '../server/sync/operations.mjs';
import { syncDatabase } from '../server/sync/store.mjs';
const document={schemaVersion:1,blocks:[{id:'heading-stable',type:'heading',props:{level:2},content:[{type:'text',text:'오프라인 계획',styles:{bold:true}}],children:[]},{id:'diagram-stable',type:'diagram',props:{},content:[{type:'text',text:'graph TD\n A-->B',styles:{}}],children:[]}]};
test('page UUID create v1 and replay preserve block props, hierarchy and timestamp',async t=>{
 const store=await fixture(t);const parent=operation(store,'page.create',{title:'부모',icon:'🗺️',parentId:null,document,clientCreatedAt:'2026-10-01T00:00:00.000Z'});
 const first=applySyncOperation(store,parent);assert.equal(first.version,1);assert.equal(first.item.id,parent.entityId);assert.deepEqual(first.item.document,document);assert.equal(first.item.clientCreatedAt,parent.payload.clientCreatedAt);
 for(let i=0;i<5;i++)assert.deepEqual(applySyncOperation(store,parent).item,first.item);
 const child=operation(store,'page.create',{title:'자식',icon:'',parentId:parent.entityId,document});assert.equal(applySyncOperation(store,child).item.parentId,parent.entityId);
 assert.throws(()=>applySyncOperation(store,operation(store,'page.create',{title:'bad',icon:'',parentId:randomUUID(),document})),e=>e.status===422);
 assert.throws(()=>applySyncOperation(store,operation(store,'page.create',{title:'bad',icon:'',parentId:null,document:{schemaVersion:2,blocks:[]}})),e=>e.status===422);
});
test('page version conflict and deletion preserve both copies without resurrection',async t=>{
 const store=await fixture(t),create=operation(store,'page.create',{title:'원본',icon:'',parentId:null,document});applySyncOperation(store,create);
 const edit={...create,kind:'page.update',operationId:randomUUID(),baseVersion:1,payload:{title:'수정',icon:'',document}};
 assert.equal(applySyncOperation(store,edit).version,2);
 assert.throws(()=>applySyncOperation(store,{...edit,operationId:randomUUID()}),e=>e.status===409&&e.current.title==='수정');
 syncDatabase(store).prepare('UPDATE pages SET deleted_at=? WHERE id=?').run(new Date().toISOString(),create.entityId);
 assert.throws(()=>applySyncOperation(store,{...edit,operationId:randomUUID(),baseVersion:2}),e=>e.status===409&&e.tombstone===true);
 assert.equal(store.getPage(create.entityId),null);
});
