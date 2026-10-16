import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
export async function offlineApp(){
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const dir=await mkdtemp(join(tmpdir(),'leneu-offline-app-')),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',AI_RUNNER_KIND:'disabled',AI_RUNNER_URL:'',GEOAPIFY_API_KEY:'',GOOGLE_MAPS_DEMO_KEY:'',OCR_RUNNER_KIND:'disabled'},stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const request=async(path,body,method='POST')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;};
 return {base,dir,browser,request,async close(){await browser.close();child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);});await rm(dir,{recursive:true,force:true});}};
}
export async function prepareShell(page){await page.evaluate(async()=>{await navigator.serviceWorker.register('/capture-worker.js',{type:'module',scope:'/'});await navigator.serviceWorker.ready;});await page.reload();}
export async function settleSync(page){await page.getByRole('button',{name:'동기화 상태',exact:true}).click();await page.getByRole('button',{name:'지금 동기화',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.sync-status')?.textContent.includes('동기화 완료'));await page.getByRole('button',{name:'동기화 상태 닫기'}).click();}
export async function waitForAsync(page,predicate,arg,timeout=45000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await page.evaluate(predicate,arg))return;await new Promise(r=>setTimeout(r,100));}throw Error('비동기 상태 확인 시간 초과');}
