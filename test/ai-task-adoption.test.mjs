import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openStore} from '../server/store.mjs';
test('selected result tasks commit atomically and same UUID cannot duplicate or change tasks',()=>{const dir=mkdtempSync(join(tmpdir(),'leneu-adopt-'));const s=openStore(dir);try{
 const capture=s.createCapture({kind:'note',text:'여행',aiRequest:{template:null,additional:'정리'}});let j=s.claimAiJob({label:'fixture'});s.completeAiJob(j.id,j.runToken,{markdown:'- [ ] 예약 확인',sources:[],usage:null});
 const input={jobId:j.id,requestId:randomUUID(),tasks:[{title:'예약 확인',dueDate:'2026-10-03'},{title:'짐 챙기기'}]};const result=s.adoptAiTasks(input);assert.equal(result.items.length,2);assert.equal(s.adoptAiTasks(input).replayed,true);assert.equal(s.listTasks().counts.open,2);
 assert.throws(()=>s.adoptAiTasks({...input,tasks:[{title:'바꿈'}]}),/다른/);
 assert.throws(()=>s.adoptAiTasks({...input,requestId:randomUUID(),tasks:[{title:'valid'},{title:''}]}),/할 일/);assert.equal(s.listTasks().counts.open,2);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}});
