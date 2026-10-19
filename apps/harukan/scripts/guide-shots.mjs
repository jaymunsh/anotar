// Pictures for the guide (/guide): a throwaway account filled with the sample season (scripts/sample-data.mjs),
// photographed step by step into public/guide/ (Korean) and public/guide/en/ (English, scripts/sample-data-en.mjs).
// Run after `npm run build`: node scripts/guide-shots.mjs [--check]
// --check writes to a temp folder instead, so it can run without touching the committed pictures.
import {chromium} from 'playwright-core';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {makeApp} from '../server/app.mjs';
import * as koData from './sample-data.mjs';
import * as enData from './sample-data-en.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const check=process.argv.includes('--check');
const temp=await mkdtemp(join(tmpdir(),'harukan-guide-')),root=check?join(temp,'shots'):resolve(project,'public/guide');
const base='http://127.0.0.1:8803',date='2026-10-16';
const app=makeApp({dataDirectory:temp,origin:base,registration:true,legalReviewed:true,legal:{publishedAt:'2026-10-18',hostingRegion:'Osaka'},mailer:async()=>{}});
await new Promise(r=>app.server.listen(8803,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
try{for(const [lang,{planning,days},nickname] of [['ko',koData,'하루'],['en',enData,'Haru']]){
  const out=lang==='ko'?root:join(root,'en');await mkdir(out,{recursive:true});
  const context=await browser.newContext({viewport:{width:1200,height:900},deviceScaleFactor:2,locale:lang==='ko'?'ko-KR':'en-US',timezoneId:'Asia/Seoul'});
  await context.addInitScript(lang=>{localStorage.setItem('anotar-planner:schedule','grid');localStorage.setItem('anotar-planner:language',lang);},lang);
  const site=await (await context.request.get(base+'/api/site')).json();
  const registered=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{email:`guide-${lang}@example.test`,nickname,password:'guide-pictures-password',termsVersion:site.termsVersion,ageConfirmed:true}});
  assert.equal(registered.status(),201);const headers={Origin:base,'X-CSRF-Token':(await registered.json()).csrf};
  for(const {id,...item} of planning)assert.equal((await context.request.put(`${base}/api/planning/${id}`,{headers,data:{...item,id,version:0}})).status(),200,id);
  for(const day of days)assert.equal((await context.request.put(`${base}/api/days/${day.date}`,{headers,data:{version:0,document:day.document}})).status(),200,day.date);

  const page=await context.newPage();page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async(path,selector)=>{await page.goto(base+path);await page.locator(selector).first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);};
  // Crop to a box around elements (page coordinates), with a little air.
  const shot=async(name,selectors,{pad=16,top=pad,from,maxHeight}={})=>{
    const boxes=[];for(const s of selectors){const b=await page.locator(s).first().boundingBox();assert.ok(b,`${name}: ${s}`);boxes.push(b);}
    const scrollY=await page.evaluate(()=>scrollY),x=Math.max(0,Math.min(...boxes.map(b=>b.x))-pad),fromY=from?(await page.locator(from).first().boundingBox()).y:Math.min(...boxes.map(b=>b.y)),y=Math.max(0,fromY-top+scrollY);
    const right=Math.max(...boxes.map(b=>b.x+b.width))+pad,bottom=Math.max(...boxes.map(b=>b.y+b.height))+pad+scrollY;
    await page.screenshot({path:join(out,name+'.png'),fullPage:true,clip:{x,y,width:right-x,height:Math.min(bottom-y,maxHeight??Infinity)}});
  };

  // 1 · Plans: goals as cards with their steps.
  await open(`/app?view=year&date=${date}`,'.goal-card');
  await shot('step-plans',['.goal-card:nth-child(1)','.goal-card:nth-child(2)']);
  // 2 · The day: priorities and notes on the left; the focus goals and routines above.
  await open(`/app?date=${date}`,'.journal-grid');
  await shot('step-today',['.journal-left'],{from:'.journal-priorities',top:4,maxHeight:600});
  await shot('step-focus',['.planning-context'],{pad:4});
  // 3 · The timetable, morning to evening.
  const top=await page.locator('.journal-hour').nth(7).boundingBox(),bottom=await page.locator('.journal-hour').nth(23).boundingBox(),grid=await page.locator('.journal-schedule').boundingBox();
  const scrollY=await page.evaluate(()=>scrollY);
  await page.screenshot({path:join(out,'step-timetable.png'),fullPage:true,clip:{x:grid.x-12,y:top.y+scrollY-6,width:grid.width+24,height:bottom.y+bottom.height-top.y+12}});
  // 4 · Review: the week's summary.
  await open(`/app/review?date=${date}`,'.review-kpis');
  await shot('step-review',['.review-headline','.review-kpis','.review-goals'],{maxHeight:700});
  // Whole day screen, for the top of the guide.
  await open(`/app?date=${date}`,'.journal-grid');
  await page.setViewportSize({width:1280,height:820});await page.waitForTimeout(200);
  await shot('day',['.journal-heading','.journal-sidebar','.journal-schedule'],{pad:20,top:12,maxHeight:820});
  assert.deepEqual(errors,[]);
  console.log(`guide pictures → ${out}`);await context.close();
}}finally{await browser.close();await new Promise(r=>app.server.close(r));await rm(temp,{recursive:true,force:true});}
