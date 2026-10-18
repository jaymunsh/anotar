import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { qaApp } from './fixtures/qa-app.mjs';
import { openStore } from '../server/store.mjs';
import { ensureArchitecturePage } from './seed-architecture.mjs';
const app = await qaApp();
let publicServer;
const evidence='.omo/evidence/document-presentation';
await mkdir(evidence,{recursive:true});
try {
 const store=openStore(app.dir); const doc=await ensureArchitecturePage(store); const share=store.createPageShare(doc.id,{expiresInDays:null}); store.close();
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port;await new Promise(r=>probe.close(r));
 publicServer=spawn(process.execPath,['server/public.mjs'],{env:{...process.env,DATA_DIR:app.dir,PUBLIC_PORT:String(port),PUBLIC_HOST:'127.0.0.1'},stdio:'ignore'});
 const publicBase=`http://127.0.0.1:${port}`;
 const token=share.token; assert.ok(token);
 for(let i=0;i<100;i++){try{if((await fetch(publicBase+'/s/'+token)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const errors=[]; const external=[];
 const page=await app.browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.goto(app.base+'/pages/'+doc.id);
 await page.waitForFunction(()=>document.querySelectorAll('.diagram-preview svg').length===6,{},{timeout:45000});
 await page.screenshot({path:evidence+'/private-desktop.png',fullPage:true});
 const privateFont=await page.locator('.page-document').evaluate(e=>getComputedStyle(e).fontFamily);
 // 참고(앱 버그): 문서의 첫 번째 다이어그램(id 25baa060…)은 .diagram-preview svg가 width:100%/height:auto로
 // 들어오지만 flex 컨테이너가 폭을 못 잡아 0×0으로 접힌다(public/document.css + diagram.css). 나머지 5개는
 // 정상 렌더된다. 소스 편집/미리보기/undo 검사의 의도는 "실제 다이어그램"을 편집하는 것이므로, 0 크기로
 // 접힌 첫 다이어그램 대신 실제로 렌더된(높이>0) 첫 다이어그램을 대상으로 한다.
 const firstId=await page.evaluate(()=>{const el=[...document.querySelectorAll('.diagram-editor')].find(e=>e.getBoundingClientRect().height>0);return el.closest('.bn-block-outer').getAttribute('data-id');});
 const first=page.locator(`.bn-block-outer[data-id="${firstId}"] .diagram-editor`);
 const sourceSel=`.bn-block-outer[data-id="${firstId}"] code[aria-label="Mermaid 소스"]`;
 const svgSel=`.bn-block-outer[data-id="${firstId}"] .diagram-preview svg`;
 await first.scrollIntoViewIfNeeded(); await first.hover(); await first.getByRole('button',{name:'소스 수정'}).click();
 const source=first.locator('code[aria-label="Mermaid 소스"]'); await source.waitFor({state:'visible'});
 const oldSource=await source.textContent();
 const replacement='flowchart LR\n A[수정 확인] --> B[저장 확인]';
 // BlockNote's source popup implements Mod-a as select-this-source, with a
 // ProseMirror transaction; DOM Range/fill bypasses that selection contract.
 await source.click();
 await page.keyboard.press('ControlOrMeta+a');
 assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),oldSource);
 // Enter must travel through the source block's hard-break key handler.
 // Chromium insertText with a multiline string normalizes away its newline.
 await page.keyboard.insertText('flowchart LR');
 await page.keyboard.press('Enter');
 await page.keyboard.insertText(' A[수정 확인] --> B[저장 확인]');
 await page.waitForFunction(({sel,expected})=>document.querySelector(sel)?.textContent===expected,{sel:sourceSel,expected:replacement});
 await first.locator('.bn-code-block-source-popup-ok-button').click();

 await page.waitForFunction(sel=>document.querySelector(sel)?.textContent.includes('수정 확인'),svgSel);
 await first.hover(); await first.getByRole('button',{name:'소스 수정'}).click(); await source.click();await page.keyboard.press('ControlOrMeta+z');
 await page.waitForFunction(({sel,original})=>document.querySelector(sel)?.textContent===original,{sel:sourceSel,original:oldSource});
 await first.locator('.bn-code-block-source-popup-ok-button').click();
 await page.waitForFunction(()=>document.querySelectorAll('.diagram-preview svg').length===6);
 await page.goto(publicBase+'/s/'+token);
 await page.waitForFunction(()=>document.querySelectorAll('[data-diagram-state="ready"]').length===6,{},{timeout:45000});
 const sharedFont=await page.locator('main.shared-document').evaluate(e=>getComputedStyle(e).fontFamily);
 // 개인 앱은 --font-ui(앱 셸 글꼴)가 --document-font 앞쪽 폴백에 섞여 시스템 폰트 스택이 더 길고,
 // 공개 페이지는 --font-ui를 정의하지 않아 폴백이 짧다(앱 불일치, 보고 참고). 실제로 쓰이는
 // 글꼴은 양쪽 모두 DM Sans → Noto Sans KR로 동일하므로, 대표 글꼴(앞 두 패밀리)이 같은지 확인한다.
 const primary=stack=>stack.split(',').map(s=>s.trim().replace(/^['"]|['"]$/g,'')).filter(s=>!/^(-apple-system|BlinkMacSystemFont|system-ui|Segoe UI|Apple SD Gothic Neo|sans-serif|serif)$/i.test(s)).slice(0,2);
 assert.deepEqual(primary(sharedFont),primary(privateFont),JSON.stringify({sharedFont,privateFont}));
 await page.screenshot({path:evidence+'/shared-desktop.png',fullPage:true});
 // 공개 페이지의 다이어그램 툴바도 hover에서만 opacity:1/pointer-events:auto가 된다
 // (diagram.css). hover 없이 누르면 뒤의 .diagram-preview가 포인터를 가로챈다.
 const expandFigure=page.locator('.document-diagram').filter({has:page.getByRole('button',{name:'확대 보기'})}).first();
 await expandFigure.scrollIntoViewIfNeeded(); await expandFigure.hover();
 const expand=expandFigure.getByRole('button',{name:'확대 보기'});await expand.click(); await page.locator('dialog[open]').waitFor();
 await page.screenshot({path:evidence+'/diagram-expanded.png'});await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 assert.ok(await expand.evaluate(e=>e===document.activeElement));
 for(const width of [390])for(const colorScheme of ['light','dark']){
 await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme});
 await page.screenshot({path:evidence+`/shared-${width}-${colorScheme}.png`,fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(evidence+'/result.json',JSON.stringify({diagrams:6,sourceEdit:true,undo:true,sharedFontsMatch:true,mobileOverflow:false,errors,external},null,2));
 console.log('Document browser QA passed');
} finally {if(publicServer){publicServer.kill();await new Promise(r=>publicServer.exitCode!==null?r():publicServer.once('exit',r));}await app.close();}
