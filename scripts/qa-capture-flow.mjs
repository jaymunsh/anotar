import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
const dir=await mkdtemp(join(tmpdir(),'anotar-capture-flow-'));
const evidence='.omo/evidence/capture-flow';await mkdir(evidence,{recursive:true});
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,DATA_DIR:dir,BACKUP_DIR:dir+'-backups',PORT:String(port),HOST:'127.0.0.1',AUTH_MODE:'disabled',AI_RUNNER_KIND:'disabled',OCR_RUNNER_URL:'',GEOAPIFY_API_KEY:'',GOOGLE_MAPS_DEMO_KEY:''},stdio:'ignore'});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const [width,theme] of [[1440,'light'],[390,'light'],[320,'dark']]){
  const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:theme});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  const create=page.getByRole('button',{name:'작성 메뉴 열기',exact:true});
  await create.waitFor({timeout:3000});
  await page.keyboard.press('Control+k');
  const searchInput=page.getByRole('combobox',{name:'통합 검색어'});await searchInput.waitFor();
  assert.equal(await searchInput.evaluate(node=>getComputedStyle(node).outlineStyle),'none','search input should not draw a rectangular focus outline');
  await page.screenshot({path:`${evidence}/search-input-${width}-${theme}.png`});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.workspace-toolbar button[aria-label="새 페이지"]').count(),0,'home toolbar should not duplicate floating creation');
  const shape=await create.evaluate(el=>({width:el.getBoundingClientRect().width,radius:parseFloat(getComputedStyle(el).borderRadius)}));
  assert.equal(shape.width,44);assert(shape.radius>=22,'writing control should be circular');
  if(width>760){
    await create.click();await page.screenshot({path:`${evidence}/desktop-create-menu.png`});
    await page.getByRole('dialog',{name:'새로 작성'}).getByRole('button',{name:'빠른 메모',exact:true}).click();
    await page.getByRole('dialog',{name:'빠른 기록',exact:true}).waitFor({timeout:3000});
    assert(await page.getByRole('textbox',{name:'메모 내용',exact:true}).evaluate(el=>el===document.activeElement));
    await page.getByRole('textbox',{name:'메모 내용',exact:true}).fill('PC에서도 남는 초안');
    await page.getByRole('button',{name:'입력 닫기',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'메모 내용',exact:true}).inputValue(),'PC에서도 남는 초안');
  }
  if(width<=760){
    await page.getByRole('button',{name:'작성 메뉴 열기',exact:true}).waitFor({timeout:3000});
    assert.equal(await page.locator('.composer').isVisible(),false);
    await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:innerHeight-180});visualViewport.dispatchEvent(new Event('resize'));});
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('button',{name:'작성 메뉴 열기',exact:true}).isVisible(),true,'viewport changes without an input focus must not hide writing');
    await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
    await page.screenshot({path:`${evidence}/mobile-home-${width}-${theme}.png`});
    await page.getByRole('button',{name:'작성 메뉴 열기',exact:true}).click();
    await page.getByRole('dialog',{name:'새로 작성'}).waitFor();
    await page.screenshot({path:`${evidence}/mobile-menu-${width}-${theme}.png`});
    await page.getByRole('button',{name:'빠른 메모',exact:true}).click();
    await page.getByRole('dialog',{name:'빠른 기록'}).waitFor();
    assert(await page.getByRole('textbox',{name:'메모 내용',exact:true}).evaluate(el=>el===document.activeElement),'memo should focus immediately');
    assert.equal(await page.getByRole('button',{name:'작성 메뉴 열기',exact:true}).isVisible(),false);
    await page.getByRole('textbox',{name:'메모 내용',exact:true}).fill('닫아도 남는 초안');
    await page.getByRole('button',{name:'입력 닫기',exact:true}).click();
    await page.getByRole('button',{name:'작성 메뉴 열기',exact:true}).click();
    await page.getByRole('button',{name:'빠른 메모',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'메모 내용',exact:true}).inputValue(),'닫아도 남는 초안');
  }
  await page.locator('.composer').waitFor();
  const options=page.locator('.composer-options');assert.equal(await options.count(),1,'input format options should be progressively disclosed');assert.equal(await options.getAttribute('open'),null);
  const text=page.getByRole('textbox',{name:'메모 내용',exact:true});await text.fill('바로 적는 메모 '+width);await options.locator('summary').click();await page.getByRole('tab',{name:'링크',exact:true}).click();await page.getByRole('textbox',{name:'링크 주소'}).fill('https://example.org/reading');
  assert.equal(await page.getByRole('textbox',{name:'링크 주소'}).evaluate(node=>getComputedStyle(node).outlineStyle),'none','link input uses its enclosing field border for focus');
  await page.getByRole('tab',{name:'메모',exact:true}).click();
  await text.fill(Array.from({length:12},(_,i)=>'메모 줄 '+i).join('\n'));assert((await text.boundingBox()).height>100,'textarea should grow with multiline draft');
  await text.fill('바로 적는 메모 '+width);
  await page.getByRole('checkbox',{name:'AI 요청',exact:true}).check();await page.getByText('AI 연결 필요',{exact:true}).waitFor();
  await page.route('**/api/ai/status',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,runner:{label:'QA 텍스트 실행기',mode:'test'},researchModes:['url'],supports:['text','research'],attachments:false})}));
  await page.getByRole('button',{name:'AI 연결 다시 확인',exact:true}).click();await page.getByText('QA 텍스트 실행기',{exact:true}).waitFor();
  const template=page.getByRole('combobox',{name:'AI 요청 템플릿'});await template.selectOption('research-keyword');
  await page.getByText(/키워드 리서치 연결이 필요해요\./).waitFor();
  await page.screenshot({path:`${evidence}/ai-${width}-${theme}.png`});
  await page.getByRole('checkbox',{name:'AI 요청',exact:true}).uncheck();
  await page.screenshot({path:`${evidence}/home-${width}-${theme}.png`});
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.locator('.capture-card').filter({hasText:'바로 적는 메모 '+width}).click();
  await page.getByRole('dialog',{name:'보관한 항목'}).waitFor();
  try { await page.getByRole('button',{name:'내 페이지에 정리',exact:false}).click({timeout:5000}); } catch(e) { await page.screenshot({path: evidence+'/failure.png'}); await writeFile(evidence+'/failure.txt',await page.locator('body').innerText()); throw e; }
  await page.getByRole('button',{name:'새 페이지',exact:true}).last().click();
  await page.getByRole('textbox',{name:'새 페이지 제목'}).fill('정리한 메모 '+width);
  await page.getByText('정리 후 원본',{exact:true}).waitFor();
  await page.screenshot({path:`${evidence}/organize-${width}-${theme}.png`});
  await page.getByRole('button',{name:'새 페이지로 정리',exact:true}).click();
  await page.waitForURL('**/pages/**');
  const response=await fetch(base+'/api/pages?q='+encodeURIComponent('정리한 메모 '+width));const data=await response.json();assert(data.items.some(p=>p.title==='정리한 메모 '+width));
  const originals=await (await fetch(base+'/api/captures?organization=organized')).json();assert(originals.items.some(p=>p.text==='바로 적는 메모 '+width),'organized original must remain recoverable');
  await page.evaluate(()=>document.activeElement?.blur?.());
  await create.waitFor();
  await page.screenshot({path:`${evidence}/global-create-page-${width}-${theme}.png`});
  await page.evaluate(()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:document.body});document.dispatchEvent(new Event('fullscreenchange'));});
  await page.waitForTimeout(50);assert.equal(await create.isVisible(),false,'fullscreen should hide writing');
  await page.evaluate(()=>{delete document.fullscreenElement;document.dispatchEvent(new Event('fullscreenchange'));});
  await create.waitFor();
  if(width>760){
    const originalUrl=page.url();
    const alignment=await page.locator('.page-document').evaluate(node=>{
      const rect=node.getBoundingClientRect();const parent=node.parentElement.getBoundingClientRect();
      return Math.abs((rect.left+rect.right)/2-(parent.left+parent.right)/2);
    });
    assert(alignment<2,'closed-panel document should be centered in the content area');
    await page.screenshot({path:`${evidence}/desktop-document-centered.png`});
    await create.click();await page.getByRole('dialog',{name:'새로 작성'}).getByRole('button',{name:'빠른 메모',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'빠른 기록',exact:true});await modal.waitFor();
    assert.equal(page.url(),originalUrl,'opening memo must preserve current document route');
    await modal.getByRole('textbox',{name:'메모 내용',exact:true}).fill('문서에서 바로 적은 메모');
    await page.screenshot({path:`${evidence}/desktop-capture-modal.png`});
    await modal.getByRole('textbox',{name:'메모 내용',exact:true}).press('Control+Enter');
    await modal.waitFor({state:'hidden'});assert.equal(page.url(),originalUrl,'saving memo must preserve current document route');
    await page.getByRole('status').filter({hasText:/기기에 저장했어요|보관함에 저장했어요/}).waitFor();
    await create.click();await page.getByRole('dialog',{name:'새로 작성'}).getByRole('button',{name:'빠른 메모',exact:true}).click();
    await modal.waitFor();await modal.getByRole('textbox',{name:'메모 내용',exact:true}).fill('Escape로 닫아도 남는 메모');
    await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});assert.equal(page.url(),originalUrl);
    await create.click();await page.getByRole('dialog',{name:'새로 작성'}).getByRole('button',{name:'빠른 메모',exact:true}).click();
    await modal.waitFor();assert.equal(await modal.getByRole('textbox',{name:'메모 내용',exact:true}).inputValue(),'Escape로 닫아도 남는 메모');
    await modal.locator('input[type=file]').setInputFiles({name:'modal-note.txt',mimeType:'text/plain',buffer:Buffer.from('modal attachment draft')});
    await modal.getByText('modal-note.txt',{exact:true}).waitFor();
    await modal.getByRole('button',{name:'입력 닫기',exact:true}).click();
    await page.waitForTimeout(100);
    assert.equal(await create.evaluate(node=>node===document.activeElement),true,'closing restores keyboard focus to writing button');
    await create.click();await page.getByRole('dialog',{name:'새로 작성'}).getByRole('button',{name:'빠른 메모',exact:true}).click();
    await modal.waitFor();await modal.getByText('modal-note.txt',{exact:true}).waitFor();
    await modal.getByRole('button',{name:'입력 닫기',exact:true}).click();
  }
  assert.equal(errors.length,0,errors.join('\n'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width<=760){
    await page.goto(base);
    await page.getByRole('button',{name:'작성 메뉴 열기',exact:true}).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog',{name:'새로 작성'}).isVisible(),false);
    await page.getByRole('button',{name:'작성 메뉴 열기',exact:true}).click();
    await page.getByRole('dialog',{name:'새로 작성'}).getByRole('button',{name:'새 페이지',exact:true}).click();
    await page.waitForURL('**/pages/**');
    await page.evaluate(()=>document.activeElement?.blur?.());
    await create.waitFor();
  }
  await ctx.close();
 }
 console.log('Quick capture, options, AI preflight, multiline drafts and memo organization: PASS');
}finally{await browser.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});await rm(dir+'-backups',{recursive:true,force:true});}
