// Carry-over from an earlier day: copy the nearest earlier schedule, bring unfinished priorities,
// phones open the list view. Isolated temporary account and DB on port 8798.
import {chromium} from 'playwright-core';
import {makeApp} from '../server/app.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const dir=await mkdtemp(join(tmpdir(),'anotar-carry-')),base='http://127.0.0.1:8798';
const app=makeApp({dataDirectory:dir,origin:base,registration:true,legalReviewed:true,legal:{publishedAt:'2026-10-12',hostingRegion:'Osaka'}});
await new Promise(r=>app.server.listen(8798,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),checks=[],errors=[];
try{
  for(const [width,height,name] of [[1280,900,'pc'],[390,844,'phone']]){
    const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    const response=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{email:'carry_'+name+'@example.test',nickname:('carry_'+name).slice(0,20),password:'temporary-test-password',termsVersion:'2026-10-18',ageConfirmed:true}});
    assert.equal(response.status(),201);
    const {csrf}=await response.json();
    // Friday has a routine, a cancelled item, one done and two open priorities; Monday is empty.
    const friday={plans:[{id:'a',title:'기상·스트레칭',start:420,end:450,status:'done'},{id:'b',title:'집중 작업',start:540,end:660,status:'missed'},{id:'c',title:'취소된 약속',start:720,end:780,status:'cancelled'}],entries:[],notes:{thoughts:'',ideas:'',review:''},priorities:[{id:'p1',text:'보고서 마감',done:false,steps:[{id:'s1',text:'표 정리',done:true},{id:'s2',text:'결론 쓰기',done:false}]},{id:'p2',text:'운동',done:true},{id:'p3',text:'은행 가기',done:false}]};
    assert.equal((await context.request.put(base+'/api/days/2026-10-16',{headers:{Origin:base,'X-CSRF-Token':csrf},data:{document:friday,version:0}})).status(),200);
    await page.goto(base+'/app?date=2026-10-19&view=day');
    const offers=page.locator('.journal-carry');
    await offers.first().waitFor();
    assert.deepEqual(await offers.allInnerTexts(),['10월 16일 (금) 2개','10월 16일 (금) 일정 2개 가져오기']);
    checks.push(`${name}: Monday offers Friday's schedule (cancelled excluded) and unfinished priorities (done excluded)`);
    assert.equal(await page.locator('.segmented .selected').first().innerText(),'하루');
    checks.push(`${name}: schedule opens in the day grid view`);
    while(await offers.count()){await offers.first().click();await page.waitForTimeout(300);}
    await page.locator('#save-status [data-state=saved]').waitFor();
    const saved=(await (await context.request.get(base+'/api/days/2026-10-19')).json()).document;
    assert.deepEqual(saved.plans.map(p=>[p.title,p.start,p.end,p.status]),[['기상·스트레칭',420,450,'pending'],['집중 작업',540,660,'pending']]);
    assert.deepEqual(saved.priorities.map(p=>[p.text,p.done]),[['보고서 마감',false],['은행 가기',false],['',false]]);
    assert.ok(saved.plans.every(p=>!['a','b'].includes(p.id)),'copies get new ids');
    checks.push(`${name}: copies come in as new pending items and fill empty priority slots, then the offers disappear`);
    assert.equal(await offers.count(),0);
    assert.deepEqual(saved.priorities[0].steps.map(s=>[s.text,s.done]),[['결론 쓰기',false]]);
    checks.push(`${name}: a carried task brings only its unfinished steps`);
    if(name==='pc'){
      const toggle=page.locator('.journal-steps-toggle').first();
      assert.equal(await toggle.innerText(),'0/1');
      await toggle.click();await page.getByRole('button',{name:'세부 할 일',exact:true}).click();
      const stepFocused=n=>page.waitForFunction(n=>document.activeElement?.getAttribute('aria-label')===`세부 할 일 ${n}`,n);
      await stepFocused(2);await page.keyboard.type('검토 요청');await page.keyboard.press('Enter');await stepFocused(3);
      await page.getByLabel('세부 할 일 1 완료').check();
      await toggle.click();
      assert.equal(await page.locator('.journal-steps').count(),0);
      assert.equal(await toggle.innerText(),'1/2');
      await page.locator('#save-status [data-state=saved]').waitFor();await page.waitForTimeout(600);
      const after=(await (await context.request.get(base+'/api/days/2026-10-19')).json()).document;
      assert.deepEqual(after.priorities[0].steps.map(s=>[s.text,s.done]),[['결론 쓰기',true],['검토 요청',false]]);
      checks.push('pc: steps fold under a task, Enter adds the next, folding drops the empty one and shows 1/2');
      await toggle.click();await page.locator('.journal-step').nth(1).hover();await page.getByRole('button',{name:'세부 할 일 2 지우기'}).click();
      assert.equal(await toggle.innerText(),'1/1');
      page.once('dialog',d=>d.accept());await page.locator('.journal-priority').first().hover();await page.getByRole('button',{name:'오늘 할 일 1 지우기'}).click();
      await page.locator('#save-status [data-state=saved]').waitFor();await page.waitForTimeout(1200);
      const removed=(await (await context.request.get(base+'/api/days/2026-10-19')).json()).document;
      assert.deepEqual(removed.priorities.map(p=>p.text),['은행 가기','','']);
      checks.push('pc: × removes a step, and a task (asking first when it has steps); 1–3 keep three slots');
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
