import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {offlineApp} from './fixtures/offline-app.mjs';
import {openStore} from '../server/store.mjs';
const app=await offlineApp();let child;
const out='.omo/evidence/code-fonts';await mkdir(out,{recursive:true});
try{
 const store=openStore(app.dir);
 const text=text=>[{type:'text',text,styles:{}}];
 const record=store.createPage({title:'문서 글꼴과 코드',document:{schemaVersion:1,blocks:[
 {id:'intro',type:'paragraph',children:[],props:{},content:text('선택한 글자를 코드로 표시합니다. 글꼴과 가독성을 비교하는 문장입니다.')},
 {id:'code',type:'codeBlock',children:[],props:{language:'javascript'},content:text('const greeting = "안녕하세요";\nconsole.log(greeting);')},
 {id:'diagram',type:'diagram',children:[],props:{},content:text('flowchart LR\n A[작성] --> B[공유]')},
 {id:'unknown',type:'codeBlock',children:[],props:{language:'custom-legacy'},content:text('원래 코드 보존')},
 ]}});const share=store.createPageShare(record.id,{expiresInDays:null});store.close();
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 child=spawn(process.execPath,['server/public.mjs'],{env:{...process.env,DATA_DIR:app.dir,PUBLIC_PORT:String(port),PUBLIC_HOST:'127.0.0.1'},stdio:'ignore'});
 const errors=[];const page=await app.browser.newPage({viewport:{width:1440,height:950}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.base+'/pages/'+record.id);
 const code=page.locator('[data-content-type="codeBlock"]').first();await code.getByLabel('코드 언어').waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-content-type="codeBlock"] code span[style]'));
 await code.hover();await code.getByLabel('코드 언어').selectOption('typescript');assert.equal(await code.getByLabel('코드 언어').inputValue(),'typescript');
 await page.mouse.move(0,0);await page.getByRole('heading',{name:'문서 글꼴과 코드',exact:true}).count();
 const diagram=page.locator('.diagram-editor');await diagram.locator('svg').waitFor();
 await diagram.hover();await diagram.getByRole('button',{name:'확대 보기'}).click();await page.locator('dialog[open]').waitFor();await page.keyboard.press('Escape');
 await page.getByLabel('설정 열기',{exact:true}).click();await page.getByLabel('앱 글꼴',{exact:true}).selectOption('ridibatang');
 await page.evaluate(()=>document.fonts.ready);assert.match(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).fontFamily),/RIDIBatang/);assert.match(await page.locator('.page-document').evaluate(el=>getComputedStyle(el).fontFamily),/RIDIBatang/);
 await page.getByLabel('설정 닫기',{exact:true}).click();await page.screenshot({path:out+'/ridi-desktop.png'});
 const paragraph=page.locator('[data-id="intro"] .bn-inline-content').first();await paragraph.click();await page.keyboard.press('Home');
 await paragraph.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await page.waitForTimeout(150);
 await page.locator('.bn-formatting-toolbar [data-test="code"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-id="intro"] code'));
 let saved=false;
 for(let attempt=0;attempt<100;attempt++){
  const {item}=await (await fetch(app.base+'/api/pages/'+record.id)).json();
  saved=item.document.blocks.find(b=>b.id==='intro').content.some(t=>t.styles?.code===true);
  if(saved)break;await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(saved,'inline code reaches durable server storage before reload');
 await page.reload();await page.locator('[data-id="intro"] code').waitFor();assert.equal(await page.locator('html').getAttribute('data-app-font'),'ridibatang');
 assert.equal(await page.getByLabel('코드 언어').first().inputValue(),'typescript');
 await page.getByLabel('설정 열기',{exact:true}).click();await page.getByLabel('앱 글꼴',{exact:true}).selectOption('pretendard');await page.getByLabel('설정 닫기',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.diagram-editor .diagram-preview svg') && !document.querySelector('.diagram-editor button:last-child').disabled);await code.hover();await page.screenshot({path:out+'/pretendard-desktop.png'});
 await page.goto(`http://127.0.0.1:${port}/s/${share.token}`);
 await page.waitForFunction(()=>document.querySelector('[data-highlighted="true"]'));
 await page.getByLabel('문서 글꼴',{exact:true}).selectOption('ridibatang');await page.reload();assert.equal(await page.getByLabel('문서 글꼴',{exact:true}).inputValue(),'ridibatang');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/shared-mobile.png'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.ok(await page.locator('pre code span[style]').count()>0);
 await page.getByLabel('화면 모드',{exact:true}).selectOption('dark');await page.screenshot({path:out+'/shared-dark.png'});
 const touch=await app.browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 await touch.goto(app.base+'/pages/'+record.id);await touch.locator('.diagram-preview svg').waitFor();
 assert.equal(await touch.locator('.diagram-toolbar').first().evaluate(el=>getComputedStyle(el).opacity),'1');
 await touch.waitForFunction(()=>document.querySelector('.diagram-editor .diagram-preview svg') && !document.querySelector('.diagram-editor button:last-child').disabled);await touch.screenshot({path:out+'/private-touch.png'});await touch.close();
 assert.deepEqual(errors,[]);
 console.log('PASS: inline code, language picker/highlight, unknown language fallback, font switching/persistence, shared highlighting/mobile');
}finally{child?.kill();await app.close();}
