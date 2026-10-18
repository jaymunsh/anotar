import {chromium} from 'playwright-core';
import {makeApp} from '../server/app.mjs';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const directory=await mkdtemp(join(tmpdir(),'anotar-layout-'));
const base='http://127.0.0.1:8796',out='.impeccable/review/workspace-layout';
await mkdir(out,{recursive:true});
const app=makeApp({dataDirectory:directory,origin:base,registration:true,legalReviewed:true,legal:{publishedAt:'2026-10-12',hostingRegion:'Osaka'}});
await new Promise(resolve=>app.server.listen(8796,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const checks=[],errors=[];
try{
 const context=await browser.newContext(),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 const registration=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{username:'abcdefghijklmnopqrstuvwx12345678',password:'temporary-layout-password',termsVersion:'2026-10-11-v1',ageConfirmed:true}});
 assert.equal(registration.status(),201);
 const session=await registration.json();
 const document={plans:[{id:'plan',title:'Review mobile schedule and prepare the next release',start:540,end:650,status:'done'},{id:'pending-plan',title:'Plan the next small step',start:720,end:780,status:'pending'}],entries:[],priorities:[{id:'priority',text:'Review the schedule',done:false}],notes:{thoughts:'Make room for the work that matters.',ideas:'One activity, shared across planning views.',review:'Leave enough time between appointments.'}};
 assert.equal((await context.request.put(base+'/api/days/2026-10-13',{headers:{Origin:base,'X-CSRF-Token':session.csrf},data:{version:0,document}})).status(),200);
 for(const language of ['ko','en'])for(const [width,height] of [[1920,1080],[1440,900],[1366,768],[1280,720],[1024,900],[768,1024],[390,844],[320,800]]){
  await page.setViewportSize({width,height});
  for(const view of ['day','week','month']){
   await page.goto(`${base}/app?date=2026-10-13&view=${view}&lang=${language}`);
   await page.locator(view==='day'?'.journal-grid':view==='week'?'.week-board':'.month-calendar').waitFor();
   await page.evaluate(()=>document.fonts.ready);
   const geometry=await page.evaluate(()=>{
    const journal=document.querySelector('.journal-page'),header=document.querySelector('.app-header'),brand=header.querySelector('.brand'),last=header.querySelector('.account-actions>button');
    const bounds=journal.getBoundingClientRect(),css=getComputedStyle(journal);
    const workspace=document.querySelector('.journal-workspace');
    return {overflow:document.documentElement.scrollWidth>innerWidth,left:bounds.left+parseFloat(css.paddingLeft),right:bounds.right-parseFloat(css.paddingRight),brandLeft:brand.getBoundingClientRect().left,headerRight:last.getBoundingClientRect().right,width:bounds.width,headerHeight:header.getBoundingClientRect().height,workspaceBottom:workspace?.getBoundingClientRect().bottom,controls:[...header.querySelectorAll('a,button,select')].filter(el=>el.getClientRects().length).map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))};
   });
   assert.equal(geometry.overflow,false,`${language} ${width} ${view} overflow`);
   assert.ok(Math.abs(geometry.left-geometry.brandLeft)<1,`${language} ${width} left alignment`);
   assert.ok(Math.abs(geometry.right-geometry.headerRight)<1,`${language} ${width} right alignment`);
   assert.ok(geometry.controls.every(control=>control.left>=0&&control.right<=width),`${language} ${width} header controls clipped`);
   if(width>=1024&&view==='day')assert.ok(geometry.workspaceBottom<=height-19,`${language} ${width} day overview exceeds viewport`);
   if(view==='week')assert.equal(await page.locator('.week-day').count(),7);
   if(language==='ko'&&[1920,1280,390].includes(width))await page.screenshot({path:`${out}/${view}-${width}.png`,fullPage:true});
   checks.push({language,width,height,view,...geometry});
  }
 }
 for(const language of ['ko','en']){
  await page.setViewportSize({width:1280,height:720});
  await page.goto(`${base}/app?date=2026-10-13&view=day&lang=${language}`);
  await page.locator('.journal-grid').waitFor();
  const doneColor=await page.locator('.journal-plan.done').first().evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(doneColor,await page.locator('.journal-plan.pending').first().evaluate(el=>getComputedStyle(el).backgroundColor));
  assert.equal(await page.locator('.journal-plan.done svg').count(),0);
  await page.getByRole('button',{name:language==='ko'?'여유롭게 보기':'Use comfortable spacing',exact:true}).click();
  await page.locator('.journal-comfortable').waitFor();
  assert.ok(await page.locator('.journal-hour').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height>=32)));
  assert.ok(await page.locator('.journal-notes textarea').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height>=110)));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${out}/comfortable-${language}-1280.png`,fullPage:true});
  await page.getByRole('button',{name:language==='ko'?'24시간 한눈에 보기':'Fit all 24 hours',exact:true}).click();
  assert.equal(await page.locator('.journal-comfortable').count(),0);
  assert.ok(await page.locator('.journal-workspace').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight-19));
 }
 for(const language of ['ko','en'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  await page.goto(`${base}/app?date=2026-10-13&view=month&lang=${language}`);
  const picker=page.getByLabel(language==='ko'?'표시할 달':'Displayed month',{exact:true});
  await picker.waitFor();await page.locator('.month-calendar').waitFor();
  assert.equal(await picker.inputValue(),'2026-10');
  await picker.fill('2026-12');await page.locator('.month-calendar').waitFor();
  await page.getByRole('button',{name:language==='ko'?'다음 달':'Next month',exact:true}).click();
  assert.equal(await picker.inputValue(),'2027-01');await page.locator('.month-calendar').waitFor();
  await page.getByRole('button',{name:language==='ko'?'이전 달':'Previous month',exact:true}).click();
  assert.equal(await picker.inputValue(),'2026-12');await page.locator('.month-calendar').waitFor();
  await picker.fill('2024-02');await page.locator('.month-calendar').waitFor();assert.equal(await page.locator('.month-day').count(),29);
  await page.getByRole('button',{name:language==='ko'?'이번 달':'This month',exact:true}).click();
  assert.equal(await picker.inputValue(),await page.evaluate(()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date())));
  await page.locator('.month-calendar').waitFor();
 }
 await page.setViewportSize({width:1280,height:720});
 await page.goto(base+'/demo?lang=en');await page.locator('.journal-grid').waitFor();
 const demoAlignment=await page.evaluate(()=>{
  const j=document.querySelector('.journal-page').getBoundingClientRect(),g=parseFloat(getComputedStyle(document.querySelector('.journal-page')).paddingLeft);
  return Math.abs(j.left+g-document.querySelector('.public-header .brand').getBoundingClientRect().left)<1;
 });
 assert.ok(demoAlignment,'demo header and journal alignment');for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.goto(base+'/demo?lang=en');await page.locator('.journal-grid').waitFor();assert.equal(await page.locator('.public-header .brand img').evaluate(el=>el.getBoundingClientRect().width),26);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}await page.setViewportSize({width:1280,height:720});
 await page.getByRole('button',{name:'Add a plan',exact:true}).click();
 await page.getByRole('dialog').waitFor();assert.ok(await page.locator('#item-title').isVisible());
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 assert.deepEqual(errors,[]);
 await writeFile(out+'/qa.json',JSON.stringify({checks,errors,demoAlignment,dailySpacing:'comfortable 32px rows and 110px notes; return to fit view; no separate done color or icon',monthNavigation:'month picker, previous/next year boundary, leap February and current month in KO/EN desktop/mobile',fixture:'temporary account and DB removed'},null,2));
 console.log(JSON.stringify({checks:checks.length,errors,demoAlignment,viewportWidths:[1920,1440,1366,1280,1024,768,390,320]},null,2));
}finally{await browser.close();await app.close();await rm(directory,{recursive:true,force:true});}
