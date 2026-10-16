import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp } from './fixtures/offline-app.mjs';
import { openStore } from '../server/store.mjs';
import { ensureArchitecturePage } from './seed-architecture.mjs';
const app=await offlineApp();
const evidence='.omo/evidence/table-hierarchy';
await mkdir(evidence,{recursive:true});
try {
 const store=openStore(app.dir);const doc=await ensureArchitecturePage(store);store.close();
 const page=await app.browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(()=>localStorage.setItem('leneu:app-font','ridibatang'));
 await page.goto(app.base+'/pages/'+doc.id);
 await page.locator('.bn-editor .page-toc').waitFor();
 const table=page.locator('[data-content-type="table"]').first();
 await table.scrollIntoViewIfNeeded();await table.hover();
 await page.locator('[data-test="dragHandle"]').click();
 await page.getByRole('menuitem',{name:'본문 너비에 맞추기',exact:true}).click();
 const sizes=await table.evaluate(el=>({block:el.getBoundingClientRect().width,table:el.querySelector('table').getBoundingClientRect().width,cols:[...el.querySelectorAll('col')].map(c=>parseFloat(c.style.width))}));
 assert.ok(Math.abs(sizes.block-sizes.table)<5,JSON.stringify(sizes));
 assert.ok(sizes.cols.every(n=>Number.isFinite(n)&&n>80));
 for(let i=0;i<100;i++){
  const current=(await (await fetch(app.base+'/api/pages/'+doc.id)).json()).item;
  const actual=current.document.blocks.find(b=>b.type==='table').content.columnWidths;
  const draft=await page.evaluate(id=>localStorage.getItem('leneu:page-draft:'+id),doc.id);
  if(JSON.stringify(actual)===JSON.stringify(sizes.cols)&&!draft)break;
  if(i===99)throw Error('Width save did not settle: '+JSON.stringify(actual));
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 await page.reload();await page.locator('.bn-editor .page-toc').waitFor();
 await table.scrollIntoViewIfNeeded();
 await page.waitForFunction(widths=>JSON.stringify([...document.querySelector('[data-content-type="table"]').querySelectorAll('col')].map(c=>parseFloat(c.style.width)))===JSON.stringify(widths),sizes.cols);

 assert.deepEqual(await table.locator('col').evaluateAll(cols=>cols.map(c=>parseFloat(c.style.width))),sizes.cols);
 await page.screenshot({path:evidence+'/ridibatang-table.png'});
 const toc=page.locator('.bn-editor .page-toc');await toc.scrollIntoViewIfNeeded();await toc.getByText('목차',{exact:true}).hover();
 await page.locator('[data-test="dragHandle"]').click();await page.getByRole('menuitem',{name:'소제목까지 목차에 표시',exact:true}).click();
 assert.ok(await toc.getByRole('button').count()>9);
 await toc.getByText('목차',{exact:true}).hover();await page.locator('[data-test="dragHandle"]').click();await page.getByRole('menuitem',{name:'대표 제목만 목차에 표시',exact:true}).click();
 assert.equal(await toc.getByRole('button').count(),9);
 const heading=page.locator('[data-content-type="heading"]').filter({hasText:'2. 전체 구조'});await heading.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/ridibatang-hierarchy.png'});
 await writeFile(evidence+'/RESULT.json',JSON.stringify({fit:sizes,persisted:true,tocDepth:true,font:'ridibatang'},null,2));
 console.log('PASS table fit, persisted widths, native TOC depth, RIDIBatang');
}finally{await app.close();}
