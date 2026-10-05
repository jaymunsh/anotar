import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
const bundled = await build({ stdin: {contents: "import * as cache from './src/offline/pageCache.ts'; import * as repo from './src/sync/repository.ts'; window.cache=cache; window.repo=repo;", resolveDir: process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html');res.end(req.url==='/test.js'?bundled.outputFiles[0].text:'<script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async()=>{
   let version=1,failed=new Set(),fetches=[];
   const value=()=>({id:'page',title:'보관 페이지',version,document:{schemaVersion:1,blocks:[{type:'asset',props:{assetId:'a'}},{type:'itinerary',props:{assetId:'b'}},{type:'asset',props:{assetId:'a'}},{type:'asset',props:{assetId:'c'}},{type:'page',props:{pageId:'child'},children:[{type:'asset',props:{assetId:'never'}}]}]}});
   const dependencies={workspaceId:'fixture',shell:async()=>({ready:true,appVersion:'v1'}),fetchEntity:async()=>({entityKind:'page',entityId:'page',item:value(),version,readSeq:version,tombstone:false}),fetchAsset:async id=>{fetches.push(id);if(failed.has(id))throw Error('fixture missing');return {blob:new Blob(['exact '+id]),name:id+'.png',mime:'image/png'};},budget:200*1024*1024};
   failed.add('c');const partial=await cache.pinPage({pageId:'page'},dependencies);if(partial.state!=='partial')throw Error('must be partial');
   failed.clear();const complete=await cache.pinPage({pageId:'page'},dependencies);if(complete.state!=='ready')throw Error('must be ready');
   const bytes=await (await repo.readLocalBlob('fixture','b')).blob.text();
   version=2;value;failed.add('c'); // invalidate a cached asset by adding a new direct reference
   const original=dependencies.fetchEntity;dependencies.fetchEntity=async()=>{const canonical=await original();canonical.item.document.blocks.push({type:'asset',props:{assetId:'d'}});return canonical;};failed.add('d');
   const update=await cache.pinPage({pageId:'page'},dependencies);const retained=await repo.readLocalEntity({workspaceId:'fixture',kind:'page',id:'page'});
   await repo.saveLocalEntity({workspaceId:'fixture',kind:'capture',id:'pending',value:{text:'keep'},blobs:[{id:'pending-file',blob:new Blob(['pending exact']),name:'p.txt',mime:'text/plain',hash:'p'}]});
   await cache.unpinPage('page',dependencies);
   return {partial,complete,update,retainedVersion:retained.current.version,bytes,unique:fetches.filter(id=>id==='a').length,never:fetches.includes('never'),pending:await (await repo.readLocalBlob('fixture','pending-file')).blob.text(),unpinned:await cache.getOfflineAvailability('page',dependencies),missing:await cache.getOfflineAvailability('unknown',dependencies)};
 });
 assert.equal(result.retainedVersion,1);assert.equal(result.bytes,'exact b');assert.equal(result.unique,1);assert.equal(result.never,false);assert.equal(result.pending,'pending exact');assert.equal(result.unpinned,'missing');assert.equal(result.missing,'missing');
 console.log('PASS page package: partial, retry, exact bytes, dedup, old successful document retained, no recursive page download, unpin preserves pending');
}finally{await browser.close();await new Promise(r=>server.close(r));}
