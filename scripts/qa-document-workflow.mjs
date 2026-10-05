import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildDocumentBlueprint } from '../shared/documentBlueprints.ts';
import { offlineApp, settleSync } from './fixtures/offline-app.mjs';
const evidence = '.omo/evidence/document-workflow';
await mkdir(evidence, { recursive: true });
const app = await offlineApp();
const block = (type, text, props = {}) => ({id: randomUUID(), type, props, content:[{type:'text',text,styles:{}}],children:[]});
try {
 const blank = (await app.request('/api/pages',{title:'제목 없음'})).item;
 const source = (await app.request('/api/pages',{title:'자료검증 교통 조사'})).item;
 const sourceDoc = {schemaVersion:1,blocks:[block('heading','환승 확인',{level:2}),block('paragraph','자료검증 첫 번째 안내. 원본은 그대로 보존합니다.'),block('paragraph','두 번째 안내는 가져오지 않습니다.')]};
 const sourceSaved = (await app.request('/api/pages/'+source.id,{expectedVersion:source.version,title:source.title,document:sourceDoc},'PUT')).item;
 const context = await app.browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page = await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.base+'/pages/'+blank.id);
 await page.locator('.bn-editor').waitFor();
 await page.getByRole('button',{name:'템플릿으로 시작',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'문서 템플릿',exact:true});
 await picker.waitFor();
 assert.equal(await picker.getByRole('button',{name:/여행 계획/}).count(),0);
 assert.equal(await picker.locator('.blueprint-options button').count(),3);
 await picker.getByRole('button',{name:/회의 기록/}).click();
 await picker.getByLabel('문서 제목').fill('문서흐름 4일 여행');
 assert.equal(await picker.getByLabel('시작 날짜').count(),0);
 await page.screenshot({path:evidence+'/template-desktop.png'});
 await picker.getByRole('button',{name:'이 템플릿 사용'}).click();
 await picker.waitFor({state:'hidden'});
 assert.equal(await page.getByLabel('페이지 제목',{exact:true}).inputValue(),'문서흐름 4일 여행');
 assert.equal(await page.locator('.itinerary-block').count(),0);
 await page.waitForFunction(()=>document.querySelector('.page-save-state')?.textContent!=='저장 중…');
 await settleSync(page);
 // Existing travel documents remain compatible although new-page menus hide them.
 const legacy=buildDocumentBlueprint('travel',{startDate:'2026-10-05',days:4});
 const legacyPage=(await app.request('/api/pages',{title:'既存旅行 · 호환 문서'})).item;
 await app.request('/api/pages/'+legacyPage.id,{expectedVersion:legacyPage.version,title:legacyPage.title,document:legacy.document},'PUT');
 await page.goto(app.base+'/pages/'+legacyPage.id); await page.locator('.bn-editor').waitFor();
 await page.locator('.itinerary-block').nth(3).waitFor();
 assert.equal(await page.locator('.itinerary-block').count(),4);
 // The normal slash menu keeps useful document tools and omits retired travel tools.
 const line=page.locator('.bn-block-content[data-content-type="paragraph"] .bn-inline-content').last();
 await line.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
 await page.keyboard.type('/'); await page.getByRole('option').first().waitFor();
 const options=await page.getByRole('option').allTextContents();
 assert.ok(options.some(text=>text.includes('콜아웃')));
 assert.ok(!options.some(text=>/^지도|^일정/.test(text.trim())));
 await page.screenshot({path:evidence+'/active-slash-menu.png'});
 await page.keyboard.press('Escape'); await page.keyboard.press('Backspace');
 await settleSync(page);
 // Copying materials is explicit and does not mutate the source.
 await page.getByRole('button',{name:'자료 가져오기',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'자료 가져오기',exact:true});
 await panel.waitFor();
 await page.screenshot({path:evidence+'/materials-desktop.png'});
 await panel.getByRole('tab',{name:'페이지',exact:true}).click();
 await panel.getByRole('textbox',{name:'자료 검색',exact:true}).fill('자료검증');
 await panel.getByRole('button',{name:source.title,exact:true}).click();
 const preview=panel.getByRole('textbox',{name:'자료 본문',exact:true});
 await preview.waitFor();
 await preview.evaluate(el=>{const text='자료검증 첫 번째 안내. 원본은 그대로 보존합니다.'; const start=el.value.indexOf(text); el.focus();el.setSelectionRange(start,start+text.length);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await panel.getByRole('button',{name:'본문 끝에 넣기',exact:true}).click();
 await page.locator('.bn-editor').getByText('자료검증 첫 번째 안내. 원본은 그대로 보존합니다.',{exact:true}).waitFor();
 assert.equal(await page.locator('.bn-editor').getByText('두 번째 안내는 가져오지 않습니다.',{exact:true}).count(),0);
 await settleSync(page);
 await page.screenshot({path:evidence+'/materials-selection-desktop.png'});
 await page.getByRole('button',{name:'자료 가져오기 닫기'}).click();
 // Outline follows scroll location, preserving the established outline UI.
 await page.getByLabel('페이지 정보',{exact:true}).click();
 await page.getByRole('button',{name:'목차 열기',exact:true}).click();
 const outline=page.getByRole('navigation',{name:'페이지 목차'});
 await outline.getByRole('button',{name:'비상 연락과 대안',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.page-outline [aria-current]')?.textContent==='비상 연락과 대안');
 await page.getByRole('button',{name:'목차 닫기',exact:true}).click();
 for(const width of [390,320]) {
   await page.setViewportSize({width,height:850});
   await page.reload(); await page.locator('.bn-editor').waitFor();
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:evidence+`/travel-template-${width}.png`,animations:'disabled'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 // Offline creation from the home template entry; online reconnection creates exactly once.
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(app.base+'/');
 await page.getByRole('button',{name:'템플릿으로 만들기',exact:true}).click();
 await picker.waitFor();
 await picker.getByRole('button',{name:/회의 기록/}).click();
 await picker.getByLabel('문서 제목').fill('오프라인 회의 기록 검증');
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await context.setOffline(true);
 await picker.getByRole('button',{name:'이 템플릿 사용'}).click();
 await page.getByLabel('페이지 제목',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('페이지 제목',{exact:true}).inputValue(),'오프라인 회의 기록 검증');
 const offlineId=new URL(page.url()).pathname.split('/').at(-1);
 await page.reload(); await page.locator('.bn-editor').waitFor();
 assert.equal(await page.getByLabel('페이지 제목',{exact:true}).inputValue(),'오프라인 회의 기록 검증');
 await context.setOffline(false);
 let created;
 for(let attempt=0;attempt<450;attempt++) {
  const response=await fetch(app.base+'/api/pages/'+offlineId);
  if(response.ok){created=(await response.json()).item;break;}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(created?.title,'오프라인 회의 기록 검증');
 assert.ok(created.document.blocks.length>5);
 // Mobile/dark picker, native modal focus and narrow inspector.
 await page.goto(app.base+'/');
 await page.setViewportSize({width:320,height:850});
 await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
 await page.getByRole('button',{name:'템플릿으로 만들기',exact:true}).click();
 await picker.waitFor();
 await page.screenshot({path:evidence+'/template-mobile-dark.png',animations:'disabled'});
 assert.ok(await picker.evaluate(el=>el.getBoundingClientRect().left>=0 && el.getBoundingClientRect().right<=innerWidth));
 await picker.getByRole('button',{name:'이 템플릿 사용'}).focus();
 await page.keyboard.press('Tab');
 assert.ok(await picker.getByRole('button',{name:'문서 템플릿 닫기'}).evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Escape'); await picker.waitFor({state:'hidden'});
 await page.goto(app.base+'/pages/'+blank.id); await page.locator('.bn-editor').waitFor();
 await page.getByLabel('페이지 정보',{exact:true}).click();
 await page.getByRole('button',{name:'자료 가져오기',exact:true}).click();
 await page.getByRole('complementary',{name:'자료 가져오기'}).waitFor();
 await page.screenshot({path:evidence+'/materials-mobile-dark.png',animations:'disabled'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const afterSource=(await (await fetch(app.base+'/api/pages/'+source.id)).json()).item;
 assert.deepEqual(afterSource,sourceSaved);
 assert.deepEqual(errors,[]);
 await writeFile(evidence+'/browser-qa.json',JSON.stringify({passed:true,temporaryData:true,checks:['blank template application','4 day independent itineraries','save and reload','source excerpt inserted and original unchanged','outline follows scrolling','320/390 overflow','offline creation/reload/reconnect','mobile dark picker/inspector','modal keyboard focus'],errors},null,2));
 console.log('Document workflow browser QA passed');
} catch (error) { for(const context of app.browser.contexts()) for(const p of context.pages()) { await p.screenshot({path:evidence+'/failure.png'}).catch(()=>{}); console.log((await p.locator('body').innerText()).slice(-2500)); } throw error; } finally { await app.close(); }
