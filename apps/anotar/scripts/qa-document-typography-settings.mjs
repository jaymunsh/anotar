import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {offlineApp} from './fixtures/offline-app.mjs';
import {defaultDocumentTypography} from '../shared/documentTypography.ts';
const evidence='.omo/evidence/document-typography-settings';
await mkdir(evidence,{recursive:true});
const app=await offlineApp(), errors=[];
const block=(type,text,props={})=>({id:crypto.randomUUID(),type,props,content:[{type:'text',text,styles:{}}],children:[]});
try {
  const created=(await app.request('/api/pages',{title:'Anotar 글자 비율 확인'})).item;
  const document={schemaVersion:1,blocks:[
    block('heading','1. 기록과 정리',{level:1}),
    block('paragraph','메모로 빠르게 생각을 남기고, 페이지에서 자료를 차분히 정리합니다. 설정에서 읽기 편한 본문 크기와 제목 비율을 선택하세요.'),
    block('heading','1.1 문서의 흐름',{level:2}),
    block('paragraph','설명은 작은 주제로 나누고, 제목과 본문의 크기를 함께 비교해요.'),
    block('heading','세부 안내',{level:3}),
    block('heading','작성 전 확인하기',{level:4}),
    block('codeBlock','const note = "오늘의 기록";',{language:'javascript'}),
    {id:crypto.randomUUID(),type:'table',props:{},children:[],content:{type:'tableContent',columnWidths:[200,350],headerRows:1,rows:[{cells:[[{type:'text',text:'화면',styles:{}}],[{type:'text',text:'할 수 있는 일',styles:{}}]]},{cells:[[{type:'text',text:'페이지',styles:{}}],[{type:'text',text:'본문과 제목의 비율 조절',styles:{}}]]}]}},
  ]};
  const saved=(await app.request('/api/pages/'+created.id,{title:created.title,document,expectedVersion:created.version},'PUT')).item;
  const context=await app.browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.base+'/pages/'+created.id);await page.locator('.bn-editor').waitFor();
  const openSettings=async()=>{const trigger=page.getByRole('button',{name:'설정 열기',exact:true});const bounds=await trigger.boundingBox();if(bounds && bounds.x<0)await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();await trigger.click();};
  const computed=async()=>page.evaluate(()=>{
    const size=selector=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
    return {body:size('[data-content-type="paragraph"] .bn-inline-content'),title:size('.page-title-input'),h1:size('.bn-editor [data-content-type="heading"]'),h2:size('[data-content-type="heading"][data-level="2"]'),h3:size('[data-content-type="heading"][data-level="3"]'),h4:size('[data-content-type="heading"][data-level="4"]'),table:size('td'),code:size('[data-content-type="codeBlock"]'),leading:parseFloat(getComputedStyle(document.querySelector('[data-content-type="paragraph"] .bn-inline-content')).lineHeight)};
  });
  const defaults=await computed();assert.equal(defaults.body,14);assert.equal(defaults.title,28);assert.equal(defaults.h1,21);
  assert.equal(defaults.h4,15.12);assert.ok(defaults.h4>defaults.body && defaults.h4<defaults.h3);
  await openSettings();
  const dialog=page.getByRole('dialog',{name:'설정',exact:true});
  await dialog.getByRole('button',{name:'보통',exact:true}).click();
  const normal=await computed();assert.equal(normal.body,15);assert.equal(normal.title,32);
  assert.equal(normal.h4,16);
  await dialog.getByRole('button',{name:'크게',exact:true}).click();assert.equal((await computed()).body,16);assert.equal((await computed()).h4,18);
  await dialog.getByRole('button',{name:'작게',exact:true}).click();
  await dialog.getByRole('button',{name:'설정 닫기',exact:true}).click();
  const compact=await computed();assert.equal(compact.body,14);assert.equal(compact.title,28);assert.equal(compact.h1,21);assert.equal(compact.table,14);assert.ok(compact.code<14);assert.ok(compact.leading<normal.leading);
  await openSettings();
  const preview=dialog.getByLabel('페이지 글자 미리보기');assert.equal(await preview.locator('.document-type-sample-title').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),compact.title);
  await dialog.getByText('제목별 비율 조절',{exact:true}).click();
  const h4=dialog.getByRole('slider',{name:'제목 4 비율',exact:true});await h4.focus();await h4.press('ArrowLeft');
  const customizedH4=await computed();assert.ok(customizedH4.h4<compact.h4 && customizedH4.h4>compact.body);
  const h1=dialog.getByRole('slider',{name:'제목 1 비율',exact:true});await h1.focus();await h1.press('ArrowLeft');await h1.press('ArrowLeft');
  const customized=await computed();assert.ok(customized.h1<compact.h1);assert.equal(customized.body,compact.body);assert.ok(customized.h1>=customized.h2 && customized.h2>=customized.h3);
  await dialog.getByRole('button',{name:'설정 닫기',exact:true}).click();
  await page.reload();await page.locator('.bn-editor').waitFor();assert.equal((await computed()).h1,customized.h1);
  const second=await context.newPage();await second.goto(app.base+'/pages/'+created.id);await second.locator('.bn-editor').waitFor();
  assert.equal(await second.locator('[data-content-type="paragraph"]').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),14);
  await openSettings();
  for(const name of ['페이지 본문 크기','페이지 줄간격','페이지 문단 간격']) {
    const slider=dialog.getByRole('slider',{name,exact:true});await slider.focus();await slider.press('ArrowRight');
  }
  assert.notDeepEqual(await computed(),defaults);
  await dialog.getByRole('button',{name:'기본값으로 설정',exact:true}).click({timeout:5000});
  assert.deepEqual(await computed(),defaults);
  assert.equal(await dialog.getByRole('button',{name:'작게',exact:true}).getAttribute('aria-pressed'),'true');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('leneu:document-typography:v1'))),defaultDocumentTypography);
  await second.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('[data-content-type="heading"]')).fontSize)===21);
  await page.reload();await page.locator('.bn-editor').waitFor();assert.deepEqual(await computed(),defaults);
  await openSettings();
  await dialog.getByRole('button',{name:'보통',exact:true}).click();
  await second.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('[data-content-type="paragraph"]')).fontSize)===15);
  await second.close();
  const captures=[];
  for(const [name,width,theme,font] of [['desktop',1440,'light','pretendard'],['mobile',390,'light','ridibatang'],['mobile-dark',320,'dark','ridibatang']]){
    await page.setViewportSize({width,height:1000});
    if((await dialog.getByRole('button',{name:'화면 모드 전환'}).getAttribute('aria-pressed'))!==String(theme==='dark'))await dialog.getByRole('button',{name:'화면 모드 전환'}).click();
    await dialog.getByRole('combobox',{name:'앱 글꼴'}).selectOption(font);
    await page.evaluate(()=>document.fonts.ready);
    const family=await preview.evaluate(el=>getComputedStyle(el).fontFamily);
    assert.match(family,font==='ridibatang'?/RIDIBatang/:/Pretendard/);
    await dialog.getByRole('button',{name:'작게',exact:true}).click();
    const detail=dialog.locator('.document-type-ratios');if((await detail.getAttribute('open'))===null)await detail.locator('summary').click();
    await dialog.locator('.settings-document-type').evaluate(el=>el.scrollIntoView({block:'start'}));
    await page.screenshot({path:`${evidence}/${name}-settings.png`});
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.ok(await dialog.locator('.settings-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await preview.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${name}-preview.png`});
    await dialog.getByRole('button',{name:'설정 닫기',exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`${evidence}/${name}-document.png`});
    captures.push({name,width,theme,font,overflow:false});
    await openSettings();
  }
  await dialog.getByRole('button',{name:'보통',exact:true}).click();await dialog.getByRole('button',{name:'설정 닫기',exact:true}).click();
  const canonical=(await(await fetch(app.base+'/api/pages/'+created.id)).json()).item;
  assert.equal(canonical.version,saved.version);assert.deepEqual(canonical.document,document);assert.deepEqual(errors,[]);
  await context.close();
  const invalidContext=await app.browser.newContext();await invalidContext.addInitScript(()=>localStorage.setItem('leneu:document-typography:v1','broken json'));
  const invalidPage=await invalidContext.newPage();await invalidPage.goto(app.base+'/pages/'+created.id);await invalidPage.locator('.bn-editor').waitFor();
  assert.equal(await invalidPage.locator('[data-content-type="paragraph"]').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),14);await invalidContext.close();
  await writeFile(evidence+'/RESULT.json',JSON.stringify({defaults,compact,customized,captures,reset:true,resetPersisted:true,reload:true,crossTab:true,invalidSettingsFallback:true,documentUnchanged:true,errors},null,2));
  console.log('PASS presets, reset to defaults and persistence, live preview and document ratios, keyboard sliders, cross-tab, malformed storage, desktop/mobile/dark, source unchanged');
}finally{await app.close();}
