// Routines: create/rename/delete in 계획, tap a chip on the day view to add an activity.
// Isolated temporary account and DB on port 8799.
import {chromium} from 'playwright-core';
import {makeApp} from '../server/app.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const dir=await mkdtemp(join(tmpdir(),'anotar-routines-')),base='http://127.0.0.1:8799';
const app=makeApp({dataDirectory:dir,origin:base,registration:true,legalReviewed:true,legal:{publishedAt:'2026-10-12',hostingRegion:'Osaka'}});
await new Promise(r=>app.server.listen(8799,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),checks=[],errors=[];
try{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  assert.equal((await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{email:'routine_qa'+'@example.test',nickname:('routine_qa').slice(0,20),password:'temporary-test-password',termsVersion:'2026-10-11-v1',ageConfirmed:true}})).status(),201);
  // Empty state on the day view points to 계획.
  await page.goto(base+'/app?date=2026-10-19&view=day');
  await page.getByRole('link',{name:'만들기'}).click();
  await page.waitForURL(/\/app\/plans/);
  const list=page.locator('#routines');await list.waitFor();
  for(const name of ['운동','독서']){await list.getByLabel('새 루틴 이름').fill(name);await list.getByLabel('새 루틴 이름').press('Enter');await list.getByLabel(`루틴 이름: ${name}`).waitFor();}
  const rename=list.getByLabel('루틴 이름: 독서');await rename.fill('독서 30분');await rename.press('Enter');
  await page.waitForTimeout(500);
  const stored=(await (await context.request.get(base+'/api/planning')).json()).items.map(i=>[i.kind,i.title]);
  assert.deepEqual(stored,[['routine','운동'],['routine','독서 30분']]);
  checks.push('routines are created and renamed in 계획 and stored as planning kind=routine');
  await page.goto(base+'/app/plans?date=2026-10-19');await page.locator('.goal-board').waitFor();
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.goal-board input')].some(e=>e.value==='운동')),false);
  checks.push('routines do not appear as goals or steps on the goal board');
  // Day view: chips, tap opens the activity dialog prefilled, save adds an ordinary activity.
  await page.goto(base+'/app?date=2026-10-19&view=day');
  const chips=page.locator('.journal-routine-chips button');await chips.first().waitFor();
  assert.deepEqual(await chips.allInnerTexts(),['운동','독서 30분']);
  await chips.first().click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await dialog.getByRole('button',{name:'저장'}).click();
  await page.getByText('서버에 저장됨').first().waitFor();
  await page.waitForTimeout(1500);
  const day=(await (await context.request.get(base+'/api/days/2026-10-19')).json()).document;
  assert.deepEqual(day.plans.map(p=>[p.title,p.start,p.end,p.status]),[['운동',540,570,'pending']]);
  assert.equal(Object.hasOwn(day.plans[0],'planningId'),false);
  checks.push('tapping a routine chip adds an ordinary 30-minute activity at 09:00 after confirming the dialog');
  await page.getByRole('button',{name:'루틴 전체 보기',exact:true}).click();const routineList=page.getByRole('dialog',{name:'루틴'});await routineList.waitFor();assert.deepEqual(await routineList.locator('li span').allInnerTexts(),['운동','독서 30분']);assert.ok(await routineList.getByRole('link',{name:'루틴 관리'}).isVisible());
  await routineList.getByRole('button',{name:'독서 30분 시간표에 넣기',exact:true}).click();await page.locator('#item-title').waitFor();assert.equal(await page.locator('#item-title').inputValue(),'독서 30분');await page.getByRole('dialog').getByRole('button',{name:'취소'}).click();
  checks.push('the › opens the full routine list; + puts a routine on the timetable, 루틴 관리 sits at the bottom');
  // Deleting the routine leaves the activity on the day.
  await page.goto(base+'/app/plans?view=routines');
  await page.locator('#routines').getByRole('button',{name:'운동 삭제'}).click();
  await page.waitForTimeout(800);
  assert.deepEqual((await (await context.request.get(base+'/api/planning')).json()).items.map(i=>i.title),['독서 30분']);
  assert.equal((await (await context.request.get(base+'/api/days/2026-10-19')).json()).document.plans[0].title,'운동');
  checks.push('deleting a routine keeps activities already added');
  // 하루 틀: start from the latest day, add a block, lay it on an empty day.
  await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));await page.goto(base+'/app/plans?view=routines');await page.getByRole('button',{name:/시간표로 새 틀/}).click();await page.locator('.template').waitFor();
  const add=page.getByLabel('틀 1에 일정 추가',{exact:true});await add.fill('독서');await add.press('Enter');await page.waitForTimeout(800);
  const template=(await (await context.request.get(base+'/api/planning')).json()).items.find(i=>i.kind==='template');assert.deepEqual(template.blocks.map(b=>[b.title,b.start,b.end]),[['운동',540,570],['독서',570,630]]);
  await page.goto(base+'/app?date=2026-10-21&view=day');await page.getByRole('button',{name:'‘틀 1’ 틀 깔기 (2개)'}).click();await page.getByText('서버에 저장됨').first().waitFor();await page.waitForTimeout(1500);
  assert.deepEqual((await (await context.request.get(base+'/api/days/2026-10-21')).json()).document.plans.map(p=>[p.title,p.start,p.end,p.status]),[['운동',540,570,'pending'],['독서',570,630,'pending']]);
  checks.push('a day template starts from the latest timetable, takes new blocks, and lays down on an empty day');
  page.on('dialog',d=>d.accept().catch(()=>{}));await page.locator('.journal-template>summary').click();await page.getByRole('menuitem',{name:'이 날 시간표를 틀로 저장'}).click();await page.waitForTimeout(1000);
  assert.equal((await (await context.request.get(base+'/api/planning')).json()).items.filter(i=>i.kind==='template').length,2);
  await page.locator('.journal-template>summary').click();await page.getByRole('menuitem',{name:/^틀 1/}).click();await page.waitForTimeout(1500);
  assert.equal((await (await context.request.get(base+'/api/days/2026-10-21')).json()).document.plans.length,2);
  checks.push('the template icon by the timetable saves this day as a template and lays one down (asking before replacing)');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
