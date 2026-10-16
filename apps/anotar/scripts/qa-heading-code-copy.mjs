import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { offlineApp, waitForAsync } from './fixtures/offline-app.mjs';
import { openStore } from '../server/store.mjs';
import { preparePageExport } from '../server/pageExport.mjs';

const app = await offlineApp();
let publicServer;
const out = '.omo/evidence/heading-code-copy';
await mkdir(out, {recursive:true});
const content = text => [{type:'text',text,styles:{}}];
const block = (id,type,text,props={}) => ({id,type,props,content:content(text),children:[]});
const source = 'const name = "안녕하세요";\n\nconsole.log(name);\n';
try {
  const store = openStore(app.dir);
  const record = store.createPage({title:'제목 단계와 코드 복사',document:{schemaVersion:1,blocks:[
    ...[1,2,3,4].map(level=>block('h'+level,'heading',`제목 ${level} 예시`,{level})),
    block('body','paragraph','본문과 제목 4의 크기를 비교합니다.'),
    block('code','codeBlock',source,{language:'javascript'}),
    block('empty-code','codeBlock','',{language:'custom-legacy'}),
    block('input','paragraph',''),
  ]}});
  const share = store.createPageShare(record.id,{expiresInDays:null});
  store.close();
  const context = await app.browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.base+'/pages/'+record.id);
  const code = page.locator('[data-id="code"] [data-content-type="codeBlock"]');
  await code.waitFor();
  await code.hover();
  assert.equal(await code.locator('.document-code-copy').count(),1,'Code blocks need a copy button');
  await code.locator('.document-code-copy').click();
  await page.waitForFunction(()=>document.querySelector('.document-code-copy')?.dataset.state === 'copied');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),source);
  const emptyCopy=page.locator('[data-id="empty-code"] .document-code-copy');
  await emptyCopy.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-id="empty-code"] .document-code-copy')?.dataset.state==='copied');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'');
  const sizes = await page.evaluate(()=>({
    body:parseFloat(getComputedStyle(document.querySelector('[data-id="body"] [data-content-type]')).fontSize),
    h4:parseFloat(getComputedStyle(document.querySelector('[data-id="h4"] [data-content-type]')).fontSize),
  }));
  assert.ok(sizes.h4 > sizes.body,JSON.stringify(sizes));
  const input = page.locator('[data-id="input"] .bn-inline-content');
  await input.click();await page.keyboard.type('> ');
  await page.locator('[data-id="input"] [data-content-type="toggleListItem"]').waitFor();
  await page.keyboard.type('접기 확인');await page.keyboard.press('Enter');
  await page.keyboard.type('" ');
  await page.locator('[data-content-type="quote"]').waitFor();
  await page.keyboard.type('인용 확인');await page.keyboard.press('Enter');
  await page.keyboard.type('#### ');
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-content-type="heading"][data-level="4"]')].length===2);
  await page.keyboard.type('직접 쓴 제목 4');await page.keyboard.press('Enter');
  await page.keyboard.type('/제목');
  await page.getByRole('option',{name:/제목\s*4/}).waitFor();
  assert.equal(await page.getByRole('option',{name:/제목\s*[56]/}).count(),0);
  await page.keyboard.press('Escape');
  await code.locator('code').fill(source+'// 최신 코드');
  assert.match(await code.locator('code').textContent(),/\/\/ 최신 코드$/,'Edited code remains in the code block');
  await code.hover();await code.locator('.document-code-copy').click();
  await waitForAsync(page,()=>document.querySelector('.document-code-copy')?.dataset.state === 'copied');
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/\/\/ 최신 코드$/);
  const currentSource = await code.locator('code').textContent();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),currentSource);
  await page.evaluate(()=>{window.originalWrite=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});
  await code.locator('.document-code-copy').click();
  await page.waitForFunction(()=>document.querySelector('.document-code-copy')?.dataset.state === 'error');
  assert.match(await code.locator('.document-code-copy').getAttribute('title'),/직접 선택/);
  await page.evaluate(()=>{navigator.clipboard.writeText=window.originalWrite;});
  await code.locator('.document-code-copy').click();
  await page.waitForFunction(()=>document.querySelector('.document-code-copy')?.dataset.state === 'copied');
  await code.hover();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-id="code"] [data-content-type="codeBlock"] > div')).opacity==='1');
  await page.screenshot({path:out+'/private-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.mouse.move(380,10);
  await page.waitForTimeout(350);await code.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:out+'/private-mobile.png'});

  const probe = createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  publicServer=spawn(process.execPath,['server/public.mjs'],{env:{...process.env,DATA_DIR:app.dir,PUBLIC_PORT:String(port),PUBLIC_HOST:'127.0.0.1'},stdio:'ignore'});
  const publicBase=`http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++){try{if((await fetch(publicBase+'/s/'+share.token)).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  await page.setViewportSize({width:1440,height:1000});await page.goto(publicBase+'/s/'+share.token);
  const publicCode=page.locator('pre[data-document-code]').first();
  await publicCode.locator('.document-code-copy').waitFor();
  await publicCode.hover();await publicCode.locator('.document-code-copy').click();
  await page.waitForFunction(()=>document.querySelector('.document-code-copy')?.dataset.state === 'copied');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await publicCode.locator('code').textContent());
  const readerSizes = await page.evaluate(()=>({body:parseFloat(getComputedStyle(document.querySelector('.block > p')).fontSize),h4:parseFloat(getComputedStyle(document.querySelector('[data-heading-level="4"]')).fontSize)}));
  assert.ok(readerSizes.h4>readerSizes.body);
  await page.screenshot({path:out+'/shared-desktop.png'});
  await page.getByLabel('화면 모드',{exact:true}).selectOption('dark');
  await publicCode.hover();await page.screenshot({path:out+'/shared-dark.png'});
  await page.setViewportSize({width:390,height:844});await publicCode.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:out+'/shared-mobile.png'});
  const touch=await app.browser.newContext({viewport:{width:390,height:844},hasTouch:true,permissions:['clipboard-write','clipboard-read']});
  const touchPage=await touch.newPage();await touchPage.goto(publicBase+'/s/'+share.token);
  const touchTools=touchPage.locator('.document-code-toolbar').first();await touchTools.waitFor();
  assert.equal(await touchTools.evaluate(el=>getComputedStyle(el).opacity),'1','Touch toolbar is visible without hover');
  await touchPage.locator('pre[data-document-code]').first().scrollIntoViewIfNeeded();
  await touchPage.screenshot({path:out+'/shared-touch.png'});
  await touch.close();

  const exportStore=openStore(app.dir);
  const saved=exportStore.getPage(record.id);
  const entries=preparePageExport({store:exportStore,pageId:record.id,expectedVersion:saved.version,dataDir:app.dir});
  exportStore.close();
  assert.ok(entries.some(e=>e.name==='assets/share-code.js'));
  const exportDir=join(app.dir,'export');
  for(const entry of entries){assert.ok(entry.data);const path=join(exportDir,entry.name);await mkdir(dirname(path),{recursive:true});await writeFile(path,entry.data);}
  await page.goto(pathToFileURL(join(exportDir,'index.html')).href);
  const offlineCode=page.locator('pre[data-document-code]').first();
  await offlineCode.locator('.document-code-copy').waitFor();
  await offlineCode.hover();await offlineCode.locator('.document-code-copy').click();
  await page.waitForFunction(()=>document.querySelector('.document-code-copy')?.dataset.state==='copied');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await offlineCode.locator('code').textContent());
  await page.screenshot({path:out+'/offline-desktop.png'});
  assert.deepEqual(errors,[]);
  await writeFile(out+'/result.json',JSON.stringify({sizes,readerSizes,errors,checks:['copy exact newlines','empty custom-language block and keyboard copy','live edited code','clipboard failure and retry','heading 4 larger than body','toggle and quote shortcuts','only 1–4 in slash menu','shared copy and dark/mobile','touch toolbar without hover','file:// offline HTML copy']},null,2));
  console.log('PASS: private/shared code copying, four heading levels, Notion input shortcuts, mobile and dark mode');
} finally {publicServer?.kill();await app.close();}
