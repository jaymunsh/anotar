import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const sources = ['flowchart LR\n A[기록] --> B{검토}\n B --> C[완료]', 'sequenceDiagram\n participant A as 사용자\n participant B as 서버\n A->>B: 저장\n B-->>A: 완료', 'flowchart LR\n A[broken', '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n A-->B', 'flowchart LR\n A@{ img: "https://evil.invalid/x" }', 'flowchart LR\n A[<img src="/api/private">]'];
sources.push(String.raw`classDiagram
 class A
 classDef default fill:u\72l(/security-probe)`, String.raw`stateDiagram-v2
 A --> B
 classDef bad background-image:image-set("/security-probe" 1x)
 class A bad`);
const escape = s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const server=createServer(async(req,res)=>{try { if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<link rel="stylesheet" href="/diagram.css">'+sources.map(s=>'<figure class="document-diagram"><div class="diagram-preview"></div><details class="diagram-source-details"><summary>소스 보기</summary><pre class="diagram-source"><code>'+escape(s)+'</code></pre></details></figure>').join('')+'<script type="module" src="/share-viewer/entry.js"></script>');}else{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(req.url==='/diagram.css'?'public/diagram.css':'dist'+req.url));}}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage(); const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>document.querySelectorAll('[data-diagram-state]').length===8);
 const states=await page.locator('.document-diagram').evaluateAll(els=>els.map(el=>el.dataset.diagramState));
 assert.deepEqual(states,['ready','ready','error','error','error','error','error','error']);
 assert.equal(await page.locator('.diagram-preview svg text').count()>0,true);
 const original=await page.locator('.diagram-source code').allTextContents();
 const firstId=await page.locator('.diagram-preview svg').first().getAttribute('id');
 await page.getByRole('button',{name:'확대 보기'}).first().click();
 await page.getByRole('button',{name:'확대',exact:true}).click(); assert.equal(await page.locator('dialog output').textContent(),'125%');
 await page.locator('.diagram-viewport').focus();await page.keyboard.press('ArrowRight');
 assert.match(await page.locator('.diagram-canvas').getAttribute('style'),/-40px/);
 await page.getByRole('button',{name:'화면에 맞추기'}).click();assert.equal(await page.locator('dialog output').textContent(),'100%');
 await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
 assert.equal(await page.getByRole('button',{name:'확대 보기'}).first().evaluate(el=>el===document.activeElement),true);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 await page.waitForFunction(id=>document.querySelector('.diagram-preview svg')?.id!==id, firstId);
 assert.deepEqual(await page.locator('.diagram-source code').allTextContents(),original);
 assert.equal(requests.some(url=>url.includes('evil.invalid')||url.includes('/api/')||url.includes('security-probe')),false);
 await page.screenshot({path:'/tmp/anotar-diagram-smoke-dark.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'확대 보기'}).first().click();
 assert.equal(await page.locator('dialog').evaluate(el=>el.getBoundingClientRect().width),390);
 await page.screenshot({path:'/tmp/anotar-diagram-smoke-mobile.png'});
 console.log(JSON.stringify({states,errors,sourcePreserved:true,zoomPanFitEscapeFocus:true,mobileWidth:390,noExternalOrPrivateRequests:true,screenshots:['/tmp/anotar-diagram-smoke-dark.png','/tmp/anotar-diagram-smoke-mobile.png']}));
}finally{await browser.close();server.close();}
