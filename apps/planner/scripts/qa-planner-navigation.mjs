import {chromium} from 'playwright-core';
import {makeApp} from '../server/app.mjs';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'anotar-navigation-')),base='http://127.0.0.1:8797',out='.impeccable/review/planner-navigation';
await mkdir(out,{recursive:true});
const app=makeApp({dataDirectory:directory,origin:base,registration:true,legalReviewed:true,legal:{publishedAt:'2026-10-12',hostingRegion:'Osaka'}});
await new Promise(resolve=>app.server.listen(8797,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),checks=[],errors=[];
try{
 const context=await browser.newContext().then(async c=>{await c.addInitScript(()=>localStorage.setItem('anotar-planner:schedule','grid'));return c;}),page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
 const response=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{username:'navigation_qa',password:'temporary-navigation-password',termsVersion:'2026-10-11-v1',ageConfirmed:true}});assert.equal(response.status(),201);const session=await response.json(),headers={Origin:base,'X-CSRF-Token':session.csrf};
 const goal={id:'goal',kind:'goal',title:'Release a useful planner',startMonth:'2026-01',endMonth:'2026-12',parentId:null,note:'',version:0};
 const step={...goal,id:'step',kind:'step',title:'Improve the mobile schedule',startMonth:'2026-10',endMonth:'2026-10',parentId:'goal'};
 for(const item of [goal,step])assert.equal((await context.request.put(base+'/api/planning/'+item.id,{headers,data:item})).status(),200);
 const document={plans:[{id:'missed',title:'Finish a first draft',start:540,end:600,status:'missed'}],entries:[],priorities:[{id:'p',text:'Prepare release checklist',done:false}],notes:{thoughts:'Keep the day simple.',ideas:'',review:''}};
 assert.equal((await context.request.put(base+'/api/days/2026-10-13',{headers,data:{document,version:0}})).status(),200);
 if(!process.env.QA_FLOW_ONLY) for(const [language,width] of [['ko',1440],['en',1280],['ko',1024],['ko',390],['en',320]]){
  await page.setViewportSize({width,height:900});
  for(const [view,section,selector] of [['day','schedule','.journal-grid'],['week','schedule','.week-board'],['month','schedule','.month-calendar'],['quarter','plans','.quarter-plan-columns'],['year','plans','.annual-plan-row'],['review','review','.journal-review']]){
   await page.goto(`${base}/app?date=2026-10-13&view=${view}&lang=${language}`);await page.locator(selector).first().waitFor();await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${view} ${width} overflow`);
   const expectedPath=section==='plans'?'/app/plans':section==='review'?'/app/review':'/app';assert.equal(new URL(page.url()).pathname,expectedPath);
   assert.equal(await page.locator('.app-nav [aria-current=page]').innerText(),({ko:{schedule:'일정',plans:'계획',review:'되짚어보기'},en:{schedule:'Schedule',plans:'Plans',review:'Review'}})[language][section]);
   assert.equal(await page.locator('.app-nav a').count(),3);
   assert.deepEqual(await page.locator('.journal-period-tabs button').allTextContents(),view==='review'?[]:section==='plans'?(language==='ko'?['분기','연간']:['Quarter','Year']):(language==='ko'?['일간','주간','월간']:['Day','Week','Month']));
   if(width>=1200&&view!=='review'){
    const positions=await page.locator('.journal-heading').evaluate(el=>{const root=el.getBoundingClientRect(),tabs=el.querySelector('.journal-period-tabs').getBoundingClientRect(),title=el.querySelector('h1').getBoundingClientRect(),date=el.querySelector('.journal-date').getBoundingClientRect();return {center:tabs.x+tabs.width/2,rootCenter:root.x+root.width/2,tabsTop:tabs.top,titleTop:title.top,dateTop:date.top,tabsRight:tabs.right,dateLeft:date.left};});
    assert.ok(Math.abs(positions.center-positions.rootCenter)<1,'period tabs centered');assert.ok(Math.abs(positions.tabsTop-positions.titleTop)<3,'tabs on heading row');assert.ok(positions.tabsRight<positions.dateLeft,'tabs do not overlap date controls');
   }
   if([1440,390].includes(width))await page.screenshot({path:`${out}/${view}-${width}.png`,fullPage:true});
   checks.push(`${view} ${width} ${language}: grouped navigation, active state, route and no overflow`);
  }
 }
 await page.setViewportSize({width:1280,height:900});await page.goto(base+'/app?date=2026-10-13&view=week&lang=en');await page.locator('.week-board').waitFor();
 await page.locator('.app-nav').getByRole('link',{name:'Plans',exact:true}).click();await page.locator('.quarter-plan-columns').waitFor();assert.equal(new URL(page.url()).searchParams.get('date'),'2026-10-13');
 await page.getByRole('button',{name:'Year',exact:true}).click();await page.reload();await page.locator('.annual-plan-row').waitFor();assert.equal(new URL(page.url()).pathname,'/app/plans');assert.equal(new URL(page.url()).searchParams.get('view'),'year');checks.push('Schedule to Plans retains date; Year survives reload');
 await page.locator('.app-nav').getByRole('link',{name:'Review',exact:true}).click();await page.locator('.journal-review').waitFor();assert.ok((await page.locator('.journal-review').innerText()).includes('Finish a first draft'));assert.equal(new URL(page.url()).searchParams.get('date'),'2026-10-13');
 await page.getByRole('button',{name:'Plan again today',exact:false}).click();await page.getByRole('dialog').waitFor();assert.equal(new URL(page.url()).pathname,'/app');assert.equal(await page.locator('.app-nav [aria-current=page]').innerText(),'Schedule');await page.getByRole('button',{name:'Close',exact:true}).click();checks.push('Review is standalone and replanning returns to Schedule');
 await page.goto(base+'/app?date=2026-10-13&view=day&lang=en');await page.locator('.planning-context>summary').click();await page.getByRole('button',{name:'Open quarter plan',exact:true}).click();await page.locator('.quarter-plan-columns').waitFor();await page.locator('.app-nav [aria-current=page]').filter({hasText:'Plans'}).waitFor();assert.equal(await page.locator('.app-nav [aria-current=page]').innerText(),'Plans');await page.locator('.quarter-plan-month>header>button').first().click();await page.locator('.month-calendar').waitFor();await page.locator('.app-nav [aria-current=page]').filter({hasText:'Schedule'}).waitFor();assert.equal(await page.locator('.app-nav [aria-current=page]').innerText(),'Schedule');checks.push('Planning context and month links update the top section');
 await page.goto(base+'/app/plans?date=2026-10-13&lang=en');await page.locator('.quarter-plan-columns').waitFor();await page.getByRole('button',{name:'Add goal',exact:true}).click();await page.locator('#planning-title').fill('Protected navigation draft');page.once('dialog',dialog=>dialog.dismiss());assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('anotar-before-leave',{cancelable:true}))),false);assert.equal(new URL(page.url()).pathname,'/app/plans');assert.equal(await page.locator('#planning-title').inputValue(),'Protected navigation draft');page.once('dialog',dialog=>dialog.accept());await page.keyboard.press('Escape');checks.push('Unsaved plan retains cancelled-leave protection');
 await page.goto(base+'/demo?lang=en');await page.locator('.journal-grid').waitFor();assert.deepEqual(await page.locator('.journal-period-tabs button').allTextContents(),['Day','Week','Month']);await page.goto(base+'/?lang=en');await page.locator('.journal-preview').waitFor();assert.equal(await page.locator('.public-header').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push('Public landing preview and demo remain usable');
 assert.equal((await context.request.get(base+'/api/tasks')).status(),410);assert.equal((await context.request.put(base+'/api/tasks/obsolete',{headers,data:{title:'Should not persist',status:'todo',version:0}})).status(),410);assert.equal(app.db.prepare("SELECT name FROM sqlite_master WHERE name='tasks'").get(),undefined);checks.push('Retired task API cannot recreate task contents');
 assert.deepEqual(errors,[]);await writeFile(out+(process.env.QA_FLOW_ONLY?'/qa-flows.json':'/qa.json'),JSON.stringify({checks,errors,fixture:'isolated account and DB removed'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await app.close();await rm(directory,{recursive:true,force:true});}
