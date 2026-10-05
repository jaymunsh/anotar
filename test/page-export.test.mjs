import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openStore} from '../server/store.mjs';import * as exporter from '../server/pageExport.mjs';
test('offline zip has a safe HTML entry and excludes private metadata; version guard precedes streaming',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'leneu-export-'));const store=openStore(dir);try{
  const page=store.createPage({title:'<script>private</script>'});
  const entries=await exporter.preparePageExport({store,pageId:page.id,expectedVersion:page.version,dataDir:dir});
  const chunks=[];for await(const chunk of exporter.zipEntries(entries))chunks.push(chunk);const zip=Buffer.concat(chunks);
  assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
  const entry=entries.find(e=>e.name==='index.html');const html=entry.data.toString();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/api\/|comments|googleMapsKey/);
  for (const match of html.matchAll(/(?:href|src)="(assets\/[^"?#]+)"/g)) {
    assert.ok(entries.some(e=>e.name===match[1]), 'Offline resource missing: '+match[1]);
  }
  assert.throws(()=>exporter.preparePageExport({store,pageId:page.id,expectedVersion:99,dataDir:dir}),/変更|변경/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('archive contains only current direct attachments, safe filenames, valid CRCs and no hidden child files',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'leneu-export-refs-'));const store=openStore(dir);try{
  mkdirSync(join(dir,'blobs'));writeFileSync(join(dir,'blobs','one'),'hello');writeFileSync(join(dir,'blobs','secret'),'private');
  const c=store.createCapture({kind:'file',files:[{key:'one',name:'../../index.html',mime:'text/html',size:5},{key:'secret',name:'secret.txt',mime:'text/plain',size:7}]});let page=store.createPage({title:'offline'});
  page=store.updatePage({id:page.id,title:page.title,expectedVersion:page.version,document:{schemaVersion:1,blocks:[{id:'f',type:'asset',props:{assetId:c.files[0].id,display:'file'},content:[],children:[]}]}});
  const entries=exporter.preparePageExport({store,pageId:page.id,expectedVersion:page.version,dataDir:dir});assert.equal(entries.filter(e=>e.path).length,1);assert.equal(entries.find(e=>e.path).name,`files/${c.files[0].id}.html`);assert.doesNotMatch(entries[0].data.toString(),/secret/);
  const chunks=[];for await(const b of exporter.zipEntries(entries))chunks.push(b);const zip=Buffer.concat(chunks);let offset=zip.readUInt32LE(zip.length-6);
  for(let i=0;i<entries.length;i++){
    assert.equal(zip.readUInt32LE(offset),0x02014b50);const length=zip.readUInt32LE(offset+24),expected=zip.readUInt32LE(offset+16),local=zip.readUInt32LE(offset+42),nameLength=zip.readUInt16LE(offset+28);
    const start=local+30+zip.readUInt16LE(local+26),bytes=zip.subarray(start,start+length);assert.equal((exporter.crc32(bytes)^0xffffffff)>>>0,expected);offset+=46+nameLength;
  }
  rmSync(join(dir,'blobs','one'));assert.throws(()=>exporter.preparePageExport({store,pageId:page.id,expectedVersion:page.version,dataDir:dir}),/원본/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
