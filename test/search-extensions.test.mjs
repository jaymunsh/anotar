import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {openStore} from '../server/store.mjs';
test('tasks, ready results and OCR update the same derived search index and respect source trash',()=>{const dir=mkdtempSync(join(tmpdir(),'leneu-search-extra-'));const s=openStore(dir);try{
 const task=s.createTask({title:'예약번호 확인'});assert.equal(s.searchRecords({query:'예약번호',type:'task'}).items[0].href,'/tasks?taskId='+task.id);
 const c=s.createCapture({kind:'image',text:'원문',files:[{key:'x',name:'x.png',mime:'image/png',size:1}],aiRequest:{template:null,additional:'정리'}});const j=s.claimAiJob({label:'fixture'});s.completeAiJob(j.id,j.runToken,{markdown:'발표내용 기술분석',sources:[],usage:null});
 assert.equal(s.searchRecords({query:'기술분석',type:'result'}).items[0].id,j.id);
 const o=s.requestOcr({assetId:c.files[0].id,requestId:randomUUID()});s.claimOcr();s.finishOcr(o.id,'교통편 예약정보');assert.equal(s.searchRecords({query:'예약정보',type:'ocr'}).items.length,1);
 s.trashRecord({kind:'capture',id:c.id,expectedVersion:c.version,operationId:randomUUID()});assert.equal(s.searchRecords({query:'기술분석'}).items.length,0);assert.equal(s.searchRecords({query:'예약정보'}).items.length,0);
 s.updateTask({id:task.id,expectedVersion:task.version,title:'다른 내용'});assert.equal(s.searchRecords({query:'예약번호'}).items.length,0);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}});
test('search links carry the exact historical OCR job and completed task identity',()=>{const dir=mkdtempSync(join(tmpdir(),'leneu-search-links-'));const s=openStore(dir);try{
 let task=s.createTask({title:'완료한 검색 대상'});task=s.updateTask({id:task.id,expectedVersion:task.version,status:'done'});assert.match(s.searchRecords({query:'완료한 검색',type:'task'}).items[0].href,new RegExp(`taskId=${task.id}`));
 const c=s.createCapture({kind:'image',files:[{key:'x',name:'x.png',mime:'image/png',size:1}]});const a=s.requestOcr({assetId:c.files[0].id,requestId:randomUUID()});s.claimOcr();s.finishOcr(a.id,'과거 고유결과');const b=s.requestOcr({assetId:c.files[0].id,requestId:randomUUID()});s.claimOcr();s.finishOcr(b.id,'최신 다른결과');assert.match(s.searchRecords({query:'과거 고유결과',type:'ocr'}).items[0].href,new RegExp(`ocrJob=${a.id}`));
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}});

test("search contexts distinguish pending, doing and done tasks and keep request originals neutral after execution", () => {
  const dir = mkdtempSync(join(tmpdir(), "leneu-search-status-"));
  const s = openStore(dir);
  try {
    let task = s.createTask({ title: "상태 검증 작업" });
    const context = () =>
      s.searchRecords({ query: "상태 검증", type: "task" }).items[0].context;
    assert.equal(context(), "대기 중 할 일");
    task = s.updateTask({
      id: task.id,
      expectedVersion: task.version,
      stage: "doing",
    });
    assert.equal(context(), "진행 중 할 일");
    task = s.updateTask({
      id: task.id,
      expectedVersion: task.version,
      stage: "done",
    });
    assert.equal(context(), "완료한 할 일");
    task = s.updateTask({
      id: task.id,
      expectedVersion: task.version,
      stage: "todo",
    });
    assert.equal(context(), "대기 중 할 일");
    const c = s.createCapture({
      kind: "note",
      text: "상태 검증 요청",
      aiRequest: { template: null, additional: "정리" },
    });
    const request = () =>
      s
        .searchRecords({ query: "상태 검증 요청", type: "ai" })
        .items.find((item) => item.id === c.id);
    assert.equal(request().context, "AI 요청 원본");
    const job = s.claimAiJob({ label: "fixture" });
    s.completeAiJob(job.id, job.runToken, {
      markdown: "상태 검증 결과",
      sources: [],
      usage: null,
    });
    assert.equal(request().context, "AI 요청 원본");
    assert.equal(
      s.searchRecords({ query: "상태 검증 결과", type: "result" }).items[0]
        .context,
      "완료된 AI 결과",
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
