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
  for(const view of ['day','week','month','year']){
   await page.goto(`${base}/app?date=2026-10-13&view=${view}&lang=${language}`);
   const selector={day:'.journal-grid',week:'.week-board',month:'.month-calendar',year:'.goal-card'}[view];
   await page.locator(selector).first().waitFor();await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${view} ${width} overflow`);
   positions.push(await page.locator('.journal-period-tabs').evaluate(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})));
   if(view==='year'){assert.equal(await page.locator('.goal-card').count(),2);assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.goal-step-title')].some(e=>e.value==='Usable mobile timetable')));assert.equal(await page.locator('.record-map').count(),0);}
   if(view==='day')assert.ok(await page.locator('.planning-context').isVisible());
   if(['week','month'].includes(view))assert.equal(await page.locator('.planning-context').count(),0);
   if(view==='month')assert.ok(await page.locator('.heading-totals').isVisible());
   if((language==='ko'&&[1440,390].includes(width))||(language==='en'&&width===1280))await page.screenshot({path:`${out}/${view}-${width}.png`,fullPage:true});
   checks.push(`${view} ${width} ${language}: planning data, no overflow`);
  }
  if(width>=1280)assert.ok(positions.every(position=>Math.abs(position.top-positions[0].top)<1&&position.height===positions[0].height),'shared day/period header rhythm');
 }
 await page.setViewportSize({width:1280,height:900});
 const plan=async id=>(await (await context.request.get(base+'/api/planning')).json()).items.find(item=>item.id===id);
 const byTitle=async title=>(await (await context.request.get(base+'/api/planning')).json()).items.find(item=>item.title===title);
 await page.goto(base+'/app?date=2026-10-13&view=day&lang=en');await page.getByRole('button',{name:'Open goals',exact:true}).click();await page.locator('.goal-card').first().waitFor();checks.push('plan chips open the goal board');
 const add=page.getByLabel('Add a step to Release a useful service',{exact:true});await add.fill('Write an onboarding checklist');await add.press('Enter');await page.locator('[data-plan]').filter({has:page.locator(':scope')}).first().waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.goal-step-title')].some(e=>e.value==='Write an onboarding checklist'));assert.equal((await byTitle('Write an onboarding checklist')).parentId,'service');
 await page.reload();await page.waitForFunction(()=>[...document.querySelectorAll('.goal-step-title')].some(e=>e.value==='Write an onboarding checklist'));checks.push('Enter in a goal card adds a step that survives reload');
 await page.getByLabel('Complete Usable mobile timetable',{exact:true}).check();await page.waitForFunction(()=>document.querySelector('.goal-progress')?.textContent==='1/3');assert.equal((await plan('mobile-step')).done,true);checks.push('checking a step marks it done and updates the goal progress');
 await page.locator('.goal-step').filter({has:page.getByLabel('Complete Prepare for first users',{exact:true})}).getByLabel('Due',{exact:true}).selectOption('year');await page.waitForTimeout(400);assert.deepEqual((({startMonth,endMonth})=>[startMonth,endMonth])(await plan('notes-step')),['2026-01','2026-12']);checks.push('due select sets a whole-year deadline');
 const title=page.locator('.goal-title').first();await title.fill('Release a helpful planner');await title.press('Enter');await page.waitForTimeout(400);assert.equal((await plan('service')).title,'Release a helpful planner');checks.push('goal title edits in place');
 await page.getByRole('button',{name:'Change goal colour',exact:true}).first().click();await page.getByRole('button',{name:'Colour 5',exact:true}).click();await page.waitForTimeout(400);assert.equal((await plan('service')).color,4);checks.push('goal colour picks from the palette');
 await page.getByRole('button',{name:'Add goal',exact:true}).click();await page.locator('.goal-card').nth(2).waitFor();const created=(await (await context.request.get(base+'/api/planning')).json()).items.filter(item=>item.kind==='goal');assert.equal(created.length,3);assert.ok(Number.isInteger(created.at(-1).color));checks.push('new goal gets a free colour');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete Release a helpful planner',exact:true}).click();await page.locator('.goal-card.no-goal').waitFor();assert.equal((await plan('mobile-step')).parentId,null);checks.push('goal deletion moves its steps to No goal');
 const other=await browser.newContext(),otherPage=await other.newPage();await other.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{username:'planning_empty_qa',password:'temporary-planning-password',termsVersion:'2026-10-11-v1',ageConfirmed:true}});await otherPage.goto(base+'/app/plans?lang=en');await otherPage.locator('.goal-empty').waitFor();assert.equal(await otherPage.locator('.goal-card').count(),0);checks.push('separate account sees genuine empty goals');await other.close();
 await page.goto(base+'/app?date=2026-10-14&view=day&lang=en');await page.getByRole('button',{name:'Add plan at 09:00',exact:true}).click();await page.locator('#item-title').fill('Tagged block');
 const pick=page.getByRole('combobox',{name:'Related plan',exact:true});await pick.selectOption({label:'Usable mobile timetable'});assert.equal(await pick.inputValue(),'mobile-step');
 await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved to server',{exact:true}).waitFor();
 assert.equal((await (await context.request.get(base+'/api/days/2026-10-14')).json()).document.plans[0].planningId,'mobile-step');
 await page.reload();await page.locator('.journal-plan[data-tag]').first().waitFor();checks.push('activity links to a plan select, saves planningId and shows the tag after reload');
 await context.route('**/api/planning',route=>route.abort());await page.goto(base+'/app?view=year&lang=en');await page.locator('.planning-board [role=alert]').waitFor();assert.ok(await page.getByRole('button',{name:'Retry',exact:true}).isVisible());checks.push('planning load failure provides recovery instead of false empty board');
 assert.deepEqual(errors,[]);await writeFile(out+'/qa.json',JSON.stringify({checks,errors,fixture:'temporary account and DB removed'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await app.close();await rm(directory,{recursive:true,force:true});}
