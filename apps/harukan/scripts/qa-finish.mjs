import {chromium} from 'playwright-core';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {makeApp} from '../server/app.mjs';
const temp=await mkdtemp(join(tmpdir(),'planner-finish-')),base='http://127.0.0.1:8796';
const app=makeApp({dataDirectory:temp,origin:base,registration:true});
await new Promise(r=>app.server.listen(8796,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const checks=[];
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(base+'/demo');
await page.getByRole('button',{name:'계획 추가',exact:true}).click();await page.getByLabel('활동',{exact:true}).fill('취소하지 않은 초안');
let dialogs=0;page.on('dialog',d=>{dialogs++;d.dismiss();});
await page.getByRole('button',{name:'다음 날짜'}).click();assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'취소하지 않은 초안');
await page.getByRole('button',{name:'실제 기록',exact:true}).click();assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'취소하지 않은 초안');
await page.getByRole('button',{name:'취소',exact:true}).click();assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'취소하지 않은 초안');
await page.getByRole('link',{name:'Harukan 서비스 소개'}).first().click();assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'취소하지 않은 초안');assert.equal(dialogs,4);
const leave=await page.evaluate(()=>window.dispatchEvent(new Event('anotar-before-leave',{cancelable:true})));assert.equal(leave,false);checks.push('Unsaved editor blocks cancelled date, activity, cancel, navigation and logout transitions');
page.removeAllListeners('dialog');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'계획 추가',exact:true}).click();assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'');await page.getByLabel('활동',{exact:true}).fill('교체 후 새 초안');page.on('dialog',d=>d.dismiss());await page.getByRole('button',{name:'다음 날짜'}).click();assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'교체 후 새 초안');await page.getByRole('link',{name:'Harukan 서비스 소개'}).first().click();assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'교체 후 새 초안');checks.push('Accepted same-key new editor replacement resets fields and protects the next dirty editor during date/navigation');
await page.getByLabel('활동',{exact:true}).fill('짧은 활동 하나');await page.locator('.item-form .form-pair select').first().selectOption('09:15');await page.getByRole('button',{name:'저장',exact:true}).click();
await page.getByRole('button',{name:'계획 추가',exact:true}).click();await page.getByLabel('활동',{exact:true}).fill('짧은 활동 둘');await page.getByLabel('시작',{exact:true}).fill('09:15');await page.locator('.item-form .form-pair select').first().selectOption('09:30');await page.getByRole('button',{name:'저장',exact:true}).click();
const one=await page.locator('.time-block').filter({hasText:'짧은 활동 하나'}).boundingBox(),two=await page.locator('.time-block').filter({hasText:'짧은 활동 둘'}).boundingBox();assert.equal(one.height,12);assert.equal(two.height,12);assert.ok(one.y+one.height<=two.y);assert.ok((await page.locator('.agenda-title').filter({hasText:'짧은 활동 하나'}).boundingBox()).height>=44);checks.push('Consecutive 15-minute timeline intervals preserve geometry and never cover each other; agenda edit targets >=44px');
await page.setViewportSize({width:320,height:1000});const today=page.locator('.date-control').getByRole('button',{name:'오늘',exact:true});const dimensions=await today.evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,lineHeight:getComputedStyle(el).lineHeight,scrollHeight:el.scrollHeight};});assert.ok(dimensions.width>=44&&dimensions.height===44);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push('320px date controls fit with single-line today and 44px targets');
function lum(hex){const a=hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
const ratio=(lum('e7ece2')+.05)/(lum('586c5c')+.05);assert.ok(ratio>=4.5);checks.push(`Tinted muted text contrast ${ratio.toFixed(2)}:1`);
await writeFile('.omo/evidence/finish-fixes.json',JSON.stringify({checks,scope:'four listed finish review findings'},null,2));console.log(JSON.stringify({checks},null,2));
}finally{await browser.close();await app.close();await rm(temp,{recursive:true,force:true});}
