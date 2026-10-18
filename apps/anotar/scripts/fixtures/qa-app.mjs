import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
// 임시 DATA_DIR·빈 포트의 개인 서버와 headless Chrome을 띄우는 QA 공용 fixture.
export async function qaApp(){
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const dir=await mkdtemp(join(tmpdir(),'leneu-qa-app-')),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',AI_RUNNER_KIND:'disabled',AI_RUNNER_URL:'',GEOAPIFY_API_KEY:'',GOOGLE_MAPS_DEMO_KEY:'',OCR_RUNNER_KIND:'disabled'},stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const request=async(path,body,method='POST')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;};
 return {base,dir,browser,request,async close(){await browser.close();child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);});await rm(dir,{recursive:true,force:true});}};
}
export async function prepareShell(page){await page.evaluate(async()=>{await navigator.serviceWorker.register('/capture-worker.js',{type:'module',scope:'/'});await navigator.serviceWorker.ready;});await page.reload();}
export async function waitForAsync(page,predicate,arg,timeout=45000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await page.evaluate(predicate,arg))return;await new Promise(r=>setTimeout(r,100));}throw Error('비동기 상태 확인 시간 초과');}
// 홈에는 인라인 입력이 없다(2026-10-17). 작성 메뉴 → 빠른 메모로 입력 창을 연다. 이미 보이면 그대로 쓴다.
export async function openQuickMemo(page){const input=page.getByRole('textbox',{name:'메모 내용',exact:true});if(await input.isVisible().catch(()=>false))return input;await page.getByRole('button',{name:'작성 메뉴 열기',exact:true}).click();await page.getByRole('dialog',{name:'새로 작성'}).getByRole('button',{name:'빠른 메모',exact:true}).click();await input.waitFor({state:'visible'});return input;}
