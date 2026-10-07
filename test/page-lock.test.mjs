import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {applySyncOperation} from '../server/sync/operations.mjs';
import {operation} from './fixtures/sync.mjs';

test('page lock persists without changing document/version/timestamps and protects writes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'anotar-page-lock-'));let store=openStore(dir);
 try {
  const page=store.createPage({title:'잠금 확인',icon:'📖'});
  const locked=store.setPageLock({id:page.id,locked:true,expectedLockVersion:0,expectedVersion:page.version});
  assert.equal(locked.locked,true);assert.equal(locked.lockVersion,1);
  for(const key of ['document','title','icon','version','createdAt','updatedAt'])assert.deepEqual(locked[key],page[key]);
  assert.throws(()=>store.updatePage({...page,title:'실수 수정',expectedVersion:page.version}),/잠금/);
  assert.deepEqual(store.getPage(page.id),locked);
  assert.deepEqual(store.setPageLock({id:page.id,locked:true,expectedLockVersion:0,expectedVersion:page.version}),locked,'Lost-response retry is idempotent');
  assert.throws(()=>store.setPageLock({id:page.id,locked:false,expectedLockVersion:0}),/잠금 상태/);
  store.close();store=openStore(dir);
  assert.equal(store.getPage(page.id).locked,true);
  store.setPageLock({id:page.id,locked:false,expectedLockVersion:1});
  const saved=store.updatePage({...page,title:'해제 후 수정',expectedVersion:page.version});
  assert.equal(saved.title,'해제 후 수정');assert.equal(saved.locked,false);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('pending offline writes remain retryable and apply with the same UUID after unlock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'anotar-page-lock-sync-'));const store=openStore(dir);
 try {
  const page=store.createPage({title:'기기 원본'});
  const op={...operation(store,'page.update',{title:'보존한 변경',icon:page.icon,document:page.document}),entityId:page.id,baseVersion:page.version};
  store.setPageLock({id:page.id,locked:true,expectedLockVersion:0,expectedVersion:page.version});
  assert.throws(()=>applySyncOperation(store,op),e=>e.status===423&&e.code==='page_locked');
  assert.equal(store.getPage(page.id).title,'기기 원본');
  store.setPageLock({id:page.id,locked:false,expectedLockVersion:1});
  assert.equal(applySyncOperation(store,op).item.title,'보존한 변경');
  assert.equal(applySyncOperation(store,op).replayed,true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('moving blocks into a locked page rolls back the source and retries safely after unlock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'anotar-page-lock-move-'));const store=openStore(dir);
 try {
  const source=store.createPage({title:'원본 블록',document:{schemaVersion:1,blocks:[{id:'preserved-block',type:'paragraph',props:{},content:[{type:'text',text:'옮길 내용',styles:{}}],children:[]}]}});
  const target=store.createPage({title:'목적지'});
  const locked=store.setPageLock({id:target.id,locked:true,expectedLockVersion:0,expectedVersion:target.version});
  const input={pageId:source.id,targetPageId:target.id,expectedVersion:source.version,targetVersion:target.version,blockIds:['preserved-block'],operationId:crypto.randomUUID()};
  assert.throws(()=>store.movePageBlocks(input),/잠금/);
  assert.deepEqual(store.getPage(source.id),source,'Source change must roll back along with the target rejection');
  assert.deepEqual(store.getPage(target.id),locked);
  store.setPageLock({id:target.id,locked:false,expectedLockVersion:1});
  const moved=store.movePageBlocks(input);
  assert.equal(moved.target.document.blocks.at(-1).content[0].text,'옮길 내용');
  assert.equal(moved.item.version,source.version+1);
  assert.equal(store.movePageBlocks(input).replayed,true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('lock rejects invalid input and stale saved document; revisions cannot overwrite a locked page',()=>{
 const dir=mkdtempSync(join(tmpdir(),'anotar-page-lock-guards-'));const store=openStore(dir);
 try {
  const page=store.createPage({title:'원본'});
  const updated=store.updatePage({...page,title:'새 원본',expectedVersion:page.version});
  assert.throws(()=>store.setPageLock({id:page.id,locked:true,expectedLockVersion:0,expectedVersion:page.version}),/수정/);
  assert.throws(()=>store.setPageLock({id:page.id,locked:'true',expectedLockVersion:0,expectedVersion:updated.version}),/잠금/);
  store.setPageLock({id:page.id,locked:true,expectedLockVersion:0,expectedVersion:updated.version});
  assert.throws(()=>store.restorePageRevision({pageId:page.id,expectedVersion:updated.version,revisionVersion:page.version,operationId:crypto.randomUUID()}),/잠금/);
  assert.equal(store.getPage(page.id).title,'새 원본');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
