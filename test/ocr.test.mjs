import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openStore} from '../server/store.mjs';
test('OCR request snapshots asset and UUID; result is separate and surviving restart failure is explicit',()=>{const dir=mkdtempSync(join(tmpdir(),'leneu-ocr-'));const s=openStore(dir);try{
 const c=s.createCapture({kind:'image',text:'원본',files:[{key:'image',name:'image.png',mime:'image/png',size:3}]});const id=c.files[0].id;
 const input={assetId:id,requestId:randomUUID()};const j=s.requestOcr(input);assert.equal(j.status,'queued');assert.equal(s.requestOcr(input).id,j.id);
 const run=s.claimOcr();assert.equal(s.claimOcr(),null);assert.equal(s.finishOcr(run.id,'인식된 텍스트'),true);assert.equal(s.getOcr(j.id).text,'인식된 텍스트');assert.equal(s.getCapture(c.id).text,'원본');
 const two=s.requestOcr({...input,requestId:randomUUID()});s.claimOcr();s.interruptOcr();assert.equal(s.getOcr(two.id).status,'failed');
 assert.throws(()=>s.requestOcr({...input,assetId:'missing'}),/첨부/);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}});
test('OCR worker uses a bounded local vision gateway with explicit image data and output validation',async()=>{
 const {createServer}=await import('node:http');const {createOcrWorker}=await import('../server/ocr.mjs');
 const dir=mkdtempSync(join(tmpdir(),'leneu-ocr-worker-'));const s=openStore(dir);mkdirSync(join(dir,'blobs'));writeFileSync(join(dir,'blobs','image'),Buffer.from([1,2,3]));
 let payload;const server=createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);payload=JSON.parse(Buffer.concat(chunks));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({text:'인식 완료'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const worker=createOcrWorker({store:s,dataDir:dir,env:{OCR_RUNNER_URL:`http://127.0.0.1:${server.address().port}`},timeoutMs:1000});
 try{const c=s.createCapture({kind:'image',files:[{key:'image',name:'x.png',mime:'image/png',size:3}]});const j=s.requestOcr({assetId:c.files[0].id,requestId:randomUUID()});worker.start();
 for(let i=0;i<100&&s.getOcr(j.id).status!=='result_ready';i++)await new Promise(r=>setTimeout(r,10));assert.equal(s.getOcr(j.id).text,'인식 완료');assert.equal(payload.image.base64,'AQID');assert.equal(payload.policy.tools,false);assert.equal(payload.image.mime,'image/png');
 assert.equal(createOcrWorker({store:s,dataDir:dir,env:{OCR_RUNNER_URL:'http://example.com'}}).enabled,false);
 }finally{await worker.stop();await new Promise(r=>server.close(r));s.close();rmSync(dir,{recursive:true,force:true});}
});
