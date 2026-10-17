import {chromium} from 'playwright-core';
import {makeApp} from '../server/app.mjs';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'anotar-planning-ui-')),base='http://127.0.0.1:8796',out='.impeccable/review/planning-board';
await mkdir(out,{recursive:true});
const app=makeApp({dataDirectory:directory,origin:base,registration:true,legalReviewed:true,legal:{publishedAt:'2026-10-12',hostingRegion:'Osaka'}});
await new Promise(resolve=>app.server.listen(8796,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),checks=[],errors=[];
try{
 const context=await browser.newContext().then(async c=>{await c.addInitScript(()=>localStorage.setItem('anotar-planner:schedule','grid'));return c;}),page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
 const registration=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{username:'planning_board_qa',password:'temporary-planning-password',termsVersion:'2026-10-11-v1',ageConfirmed:true}});
 assert.equal(registration.status(),201);const session=await registration.json(),headers={Origin:base,'X-CSRF-Token':session.csrf};
 const make=(id,kind,title,startMonth,endMonth,parentId=null)=>({id,kind,title,startMonth,endMonth,parentId,note:'',version:0});
 const fixture=[make('service','goal','Release a useful service','2026-01','2026-12'),make('learning','goal','Build a steady learning routine','2026-04','2026-12'),make('mobile-step','step','Usable mobile timetable','2026-10','2026-10','service'),make('notes-step','step','Prepare for first users','2026-11','2026-11','service'),make('learning-step','step','Small weekly practice projects','2026-11','2026-12','learning')];
 for(const item of fixture)assert.equal((await context.request.put(base+'/api/planning/'+item.id,{headers,data:item})).status(),200);
 for(const [language,width] of [['ko',1440],['en',1280],['ko',1024],['ko',390],['en',320]]){
  await page.setViewportSize({width,height:900});const positions=[];
  for(const view of ['day','week','month','quarter','year']){
   await page.goto(`${base}/app?date=2026-10-13&view=${view}&lang=${language}`);
   const selector={day:'.journal-grid',week:'.week-board',month:'.month-calendar',quarter:'.quarter-plan-columns',year:'.annual-plan-row'}[view];
   await page.locator(selector).first().waitFor();await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${view} ${width} overflow`);
   positions.push(await page.locator('.journal-period-tabs').evaluate(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})));
   if(view==='quarter'){assert.equal(await page.locator('.quarter-plan-month').count(),3);assert.ok((await page.locator('.planning-board').innerText()).includes('Usable mobile timetable'));assert.equal(await page.locator('.quarter-diary').count(),0);}
   if(view==='year'){assert.equal(await page.locator('.annual-plan-row').count(),2);assert.equal(await page.locator('.record-map').count(),0);}
   if(['day','week','month'].includes(view))assert.ok(await page.locator('.planning-context').isVisible());
   if((language==='ko'&&[1440,390].includes(width))||(language==='en'&&width===1280))await page.screenshot({path:`${out}/${view}-${width}.png`,fullPage:true});
   checks.push(`${view} ${width} ${language}: planning data, no overflow`);
  }
  if(width>=1280)assert.ok(positions.every(position=>Math.abs(position.top-positions[0].top)<1&&position.height===positions[0].height),'shared day/period header rhythm');
 }
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/app?date=2026-10-13&view=quarter&lang=ko');await page.locator('.quarter-plan-month').first().waitFor();await page.getByRole('button',{name:'2026-11 세부 계획 추가',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/dialog-390.png',fullPage:false});await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});await page.goto(base+'/app?date=2026-10-13&view=quarter&lang=en');await page.locator('.quarter-plan-month').first().waitFor();
 await page.getByRole('button',{name:'Add step for 2026-11',exact:true}).click();await page.getByRole('dialog').waitFor();
 await page.locator('#planning-title').fill('Write an onboarding checklist');await page.getByLabel('Related goal',{exact:true}).selectOption('service');await page.getByRole('dialog').locator('summary').click();await page.getByRole('dialog').getByRole('textbox',{name:'Note',exact:true}).fill('Keep this implementation simple.');
 await page.screenshot({path:out+'/dialog-1280.png',fullPage:false});await page.getByRole('button',{name:'Save plan',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.reload();await page.getByRole('button',{name:/Write an onboarding checklist/}).waitFor();checks.push('native step modal saves goal and note and survives reload');
 await page.getByRole('button',{name:/Write an onboarding checklist/}).click();await page.locator('#planning-title').fill('Draft not saved');page.once('dialog',dialog=>dialog.dismiss());await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);page.once('dialog',dialog=>dialog.accept());await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);checks.push('dirty planning dialog protects input on Escape');
 await page.getByRole('button',{name:'Year',exact:true}).click();await page.locator('.annual-plan-row').first().waitFor();await page.locator('.annual-goal-name>button').filter({hasText:'Release a useful service'}).click();await page.locator('#planning-title').fill('Release a helpful planner');await page.getByRole('button',{name:'Save plan',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.reload();await page.locator('.annual-goal-name>button').filter({hasText:'Release a helpful planner'}).waitFor();checks.push('goal edit persists and updates annual roadmap');
 await page.locator('.app-nav').getByRole('link',{name:'Schedule',exact:true}).click();await page.getByRole('button',{name:'Week',exact:true}).click();await page.locator('.planning-context>summary').click();await page.getByRole('button',{name:'Open quarter plan',exact:true}).click();await page.locator('.quarter-plan-columns').waitFor();checks.push('planning context in diary opens matching quarter');
 await page.getByRole('button',{name:'Year',exact:true}).click();await page.getByRole('button',{name:'Add goal',exact:true}).click();await page.locator('#planning-title').fill('A small personal project');await page.getByRole('button',{name:'Save plan',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.locator('.annual-plan-row').count(),3);checks.push('new goal has a saved year range');
 await page.locator('.annual-goal-name>button').filter({hasText:'Release a helpful planner'}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});const afterDelete=(await (await context.request.get(base+'/api/planning')).json()).items;assert.ok(afterDelete.some(item=>item.title==='Usable mobile timetable'&&item.parentId===null));checks.push('goal deletion preserves steps');
 const other=await browser.newContext().then(async c=>{await c.addInitScript(()=>localStorage.setItem('anotar-planner:schedule','grid'));return c;}),otherPage=await other.newPage();await other.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{username:'planning_empty_qa',password:'temporary-planning-password',termsVersion:'2026-10-11-v1',ageConfirmed:true}});await otherPage.goto(base+'/app?view=year&lang=en');await otherPage.locator('.annual-plan-empty').waitFor();assert.equal(await otherPage.locator('.annual-plan-row').count(),0);checks.push('separate account sees genuine empty planner');await other.close();
 await page.goto(base+'/app?date=2026-10-14&view=day&lang=en');await page.getByRole('button',{name:'Add plan at 09:00',exact:true}).click();await page.locator('#item-title').fill('Tagged block');
 const pick=page.getByRole('combobox',{name:'Related plan',exact:true});await pick.selectOption({label:'Usable mobile timetable'});assert.equal(await pick.inputValue(),'mobile-step');
 await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved to server',{exact:true}).waitFor();
 assert.equal((await (await context.request.get(base+'/api/days/2026-10-14')).json()).document.plans[0].planningId,'mobile-step');
 await page.reload();await page.locator('.journal-plan[data-tag]').first().waitFor();checks.push('activity links to a plan select, saves planningId and shows the tag after reload');
 await context.route('**/api/planning',route=>route.abort());await page.goto(base+'/app?view=year&lang=en');await page.locator('.planning-board [role=alert]').waitFor();assert.ok(await page.getByRole('button',{name:'Retry',exact:true}).isVisible());checks.push('planning load failure provides recovery instead of false empty board');
 assert.deepEqual(errors,[]);await writeFile(out+'/qa.json',JSON.stringify({checks,errors,fixture:'temporary account and DB removed'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await app.close();await rm(directory,{recursive:true,force:true});}
