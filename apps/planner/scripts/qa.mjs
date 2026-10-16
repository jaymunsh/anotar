import {chromium} from 'playwright-core';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {makeApp} from '../server/app.mjs';

const temp=await mkdtemp(join(tmpdir(),'anotar-planner-ui-'));
const base='http://127.0.0.1:8795',out=resolve('.impeccable/review');
await mkdir(out,{recursive:true});
const app=makeApp({dataDirectory:temp,origin:base,registration:true});
await new Promise(r=>app.server.listen(8795,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const errors=[],checks=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  async function shot(path,name,width=1440){await page.setViewportSize({width,height:1000});await page.goto(base+path);await page.evaluate(()=>document.fonts.ready);await page.locator('.save-status').first().waitFor({state:'visible',timeout:1000}).catch(()=>{});await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;scroll-behavior:auto!important}'});await page.screenshot({path:join(out,name),fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`${path} overflow ${width}`);checks.push(`${path}: ${width}px no overflow`);}
  await shot('/','desktop.png');await shot('/','mobile.png',390);await shot('/demo','planner-desktop.png');await shot('/demo','planner-mobile.png',390);await shot('/login','login-mobile.png',390);await shot('/privacy','privacy-desktop.png');await shot('/','landing-320.png',320);await shot('/demo','planner-320.png',320);
  await page.goto(base+'/signup');await page.getByLabel('아이디',{exact:true}).fill('planner_example');await page.getByLabel('비밀번호',{exact:true}).fill('qa-only-account-password');await page.getByRole('checkbox').nth(0).check();await page.getByRole('checkbox').nth(1).check();await page.getByRole('button',{name:'가입하고 시작하기'}).click();await page.getByRole('heading',{name:'복구코드를 보관해 주세요'}).waitFor();
  await page.getByRole('link',{name:'보관했어요 · 시간표로 이동'}).click();await page.getByRole('button',{name:'계획 추가',exact:true}).waitFor();
  await page.getByRole('button',{name:'계획 추가',exact:true}).click();await page.getByLabel('활동',{exact:true}).fill('내 시간표 기록');await page.getByRole('button',{name:'저장',exact:true}).click();await page.getByText('서버에 저장됨',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'내 시간표 기록 예정'}).waitFor();
  await page.getByRole('button',{name:'내 시간표 기록 계획대로 했어요'}).click();await page.getByText('서버에 저장됨',{exact:true}).waitFor();assert.equal(await page.getByText('1시간',{exact:true}).count(),1);
  await page.getByLabel('하루 돌아보기').fill('집중할 시간과 쉬는 시간을 함께 돌아봤어요.');await page.getByText('서버에 저장됨',{exact:true}).waitFor();
  await shot('/app','account-mobile.png',390);await shot('/app/settings','settings-320.png',320);
  await page.goto(base+'/app/tasks');await page.getByLabel('새 할 일').fill('여러 날 이어갈 작업');await page.getByRole('button',{name:'추가',exact:true}).click();await page.getByText('여러 날 이어갈 작업',{exact:true}).waitFor();await page.getByRole('link',{name:'오늘에 배치'}).click();await page.getByLabel('활동',{exact:true}).waitFor();assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'여러 날 이어갈 작업');await page.getByRole('button',{name:'저장',exact:true}).click();await page.getByText('서버에 저장됨',{exact:true}).waitFor();
  const session=await (await page.request.get(base+'/api/auth/session')).json(),date=await page.locator('input[type=date]').inputValue(),saved=await (await page.request.get(base+'/api/days/'+date)).json();
  saved.document.notes.ideas='다른 기기에서 먼저 작성';await page.request.put(base+'/api/days/'+date,{headers:{Origin:base,'X-CSRF-Token':session.csrf},data:{version:saved.version,document:saved.document}});
  await page.getByLabel('아이디어',{exact:true}).fill('이 기기 초안은 사라지지 않아야 해요.');await page.getByText('다른 기기 변경 확인 필요',{exact:true}).waitFor();assert.equal(await page.getByLabel('아이디어',{exact:true}).inputValue(),'이 기기 초안은 사라지지 않아야 해요.');
  await page.reload();await page.getByRole('button',{name:'초안 이어서 작성'}).click();await page.getByText('다른 기기 변경 확인 필요',{exact:true}).waitFor();assert.equal(await page.getByLabel('아이디어',{exact:true}).inputValue(),'이 기기 초안은 사라지지 않아야 해요.');
  checks.push('signup → recovery code → plan save/reload → confirmed actual entry → notes save → task linkage → concurrent conflict preserves device draft on reload');
  assert.deepEqual(errors,[]);await writeFile('.omo/evidence/qa.json',JSON.stringify({checks,errors,fixture:'temporary database removed after QA'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await app.close();await rm(temp,{recursive:true,force:true});}
