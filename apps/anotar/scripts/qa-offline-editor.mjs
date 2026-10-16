import assert from 'node:assert/strict';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';
const app=await offlineApp();const text=s=>[{type:'text',text:s,styles:{}}];
try{
 const {item}=await app.request('/api/pages',{title:'오프라인 문서 도구'});
 const blocks=[{id:'heading',type:'heading',props:{level:2},content:text('여행 일정 목차'),children:[]},{id:'toc',type:'tableOfContents',props:{},children:[]},{id:'paragraph',type:'paragraph',props:{},content:text('수정할 문장'),children:[]},{id:'table',type:'table',props:{},content:{type:'tableContent',rows:[{cells:[text('시간'),text('장소')]},{cells:[text('10:00'),text('공원')]}]},children:[]},{id:'diagram',type:'diagram',props:{},content:text('graph TD\n A[출발] --> B[도착]'),children:[]}];
 await app.request('/api/pages/'+item.id,{title:item.title,icon:'',expectedVersion:item.version,document:{schemaVersion:1,blocks}},'PUT');
 const context=await app.browser.newContext(),page=await context.newPage();await page.goto(app.base+'/pages/'+item.id);await page.locator('.bn-editor table').waitFor();await prepareShell(page);await context.setOffline(true);
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});const editable=page.locator('[data-id="paragraph"] .bn-inline-content').first();await editable.click();await page.keyboard.press('End');await page.keyboard.insertText(` ${width} 한글 편집`);await page.getByText('기기에 저장됨',{exact:true}).waitFor();
  await page.keyboard.press('Meta+z');await page.keyboard.press('Meta+Shift+z');
  await editable.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
  await page.getByLabel('페이지 제목',{exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('.bn-editor table').count(),1);assert.ok(await page.getByText('여행 일정 목차',{exact:true}).count());
 }
 await page.locator('[data-id="paragraph"] .bn-inline-content').first().click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.insertText('/');await page.getByRole('option').first().waitFor();await page.keyboard.press('Escape');await page.keyboard.press('Backspace');
 await page.locator('.bn-editor').evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','# 붙여넣은 제목\n\n**굵은 글씨**와 본문');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
 await page.getByText('붙여넣은 제목',{exact:true}).first().waitFor();await page.getByText('기기에 저장됨',{exact:true}).waitFor();await page.reload();await page.getByText('붙여넣은 제목',{exact:true}).first().waitFor();assert.equal(await page.locator('.bn-editor table').count(),1);
 console.log('PASS offline editor: 390/320 Korean/IME/undo/redo, existing table/TOC/diagram document, slash menu, Markdown paste, offline reload');
}finally{await app.close();}
