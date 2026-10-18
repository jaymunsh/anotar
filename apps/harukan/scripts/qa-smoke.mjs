// Broad smoke pass over every screen: public pages in both languages at desktop/phone widths, the app without the API,
// and a signed-in account across day/week/month, review and settings (layout, notes save/reload, a save conflict).
import {chromium} from 'playwright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {makeApp} from '../server/app.mjs';

const temp=await mkdtemp(join(tmpdir(),'harukan-smoke-')),base='http://127.0.0.1:8802';
const app=makeApp({dataDirectory:temp,origin:base,registration:true,legalReviewed:true,legal:{publishedAt:'2026-10-12',hostingRegion:'Osaka'},mailer:async()=>{}});
await new Promise(r=>app.server.listen(8802,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const checks=[],errors=[];
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
try{
  // Public pages: no sideways scroll, right lang attribute, no Korean left on English pages.
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const route of ['/','/demo','/guide','/login','/signup','/forgot','/about','/privacy','/terms','/contact'])for(const [width,lang] of [[1440,'ko'],[390,'en'],[320,'ko']]){
    await page.setViewportSize({width,height:900});await page.goto(base+route+'?lang='+lang);await page.locator('main h1, article h1').first().waitFor();await page.evaluate(()=>document.fonts.ready);
    assert.equal(await overflow(page),false,`${route} ${width} overflow`);assert.equal(await page.locator('html').getAttribute('lang'),lang);
    if(lang==='en'&&route!=='/demo'){const text=(await page.locator('body').innerText()).replaceAll('한국어','').replaceAll('하루칸','').replaceAll('문성혁','');const left=text.match(/[^\n]*[가-힣][^\n]*/g);assert.ok(!left,`${route} untranslated: ${left}`);}
  }
  checks.push('public pages: ko/en at 1440/390/320, no overflow, English fully translated');

  // Without the API: public pages stay quiet (only the landing asks for a session, to send signed-in people on to /app); the app says it cannot connect, in either language.
  const offline=await browser.newContext(),off=await offline.newPage();let sessionRequests=0;off.on('pageerror',e=>errors.push(e.message));
  off.on('request',r=>{if(r.url().endsWith('/api/auth/session'))sessionRequests++;});await offline.route('**/api/**',r=>r.abort('failed'));
  await off.goto(base+'/?lang=en');await off.locator('main h1').first().waitFor();assert.equal(await off.getByRole('alert').count(),0);
  await off.goto(base+'/about?lang=en');await off.locator('main h1, article h1').first().waitFor();assert.equal(await off.getByRole('alert').count(),0);assert.equal(sessionRequests,1,'only the landing checks for a session (to send signed-in people to /app)');
  await off.goto(base+'/app?lang=en');await off.getByRole('alert').waitFor();assert.ok((await off.getByRole('alert').textContent()).includes('connect'));
  checks.push('API down: landing and info pages render quietly; app shows a connection alert');await offline.close();

  // A signed-in account with one day of data.
  const register=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{email:'smoke@example.test',nickname:'아주긴닉네임스무글자까지쓰는사람',password:'temporary-smoke-password',termsVersion:'2026-10-18',ageConfirmed:true}});
  assert.equal(register.status(),201);const {csrf}=await register.json(),headers={Origin:base,'X-CSRF-Token':csrf};
  const document={plans:[{id:'p1',title:'Review mobile schedule and prepare the next release',start:540,end:650,status:'done'},{id:'p2',title:'Plan the next small step',start:720,end:780,status:'pending'}],entries:[],priorities:[{id:'pr',text:'Review the schedule',done:false}],notes:{thoughts:'Make room for the work that matters.',ideas:'',review:''}};
  assert.equal((await context.request.put(base+'/api/days/2026-10-13',{headers,data:{version:0,document}})).status(),200);
  for(const lang of ['ko','en'])for(const [width,height] of [[1920,1080],[1440,900],[1280,720],[1024,768],[768,1024],[390,844],[320,800]]){
    await page.setViewportSize({width,height});
    for(const view of ['day','week','month']){
      await page.goto(`${base}/app?date=2026-10-13&view=${view}&lang=${lang}`);await page.locator('.journal-page').waitFor();await page.evaluate(()=>document.fonts.ready);
      assert.equal(await overflow(page),false,`${lang} ${width} ${view} overflow`);
      const clipped=await page.evaluate(w=>[...document.querySelectorAll('.app-header a,.app-header button')].filter(e=>e.getClientRects().length).some(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>w;}),width);
      assert.equal(clipped,false,`${lang} ${width} header controls clipped`);
      if(view==='day'&&width>760){assert.equal(await page.locator('.journal-hour').count(),24,`${lang} ${width} 24 hours`);if(width>=1024)assert.ok(await page.locator('.journal-workspace').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),`${lang} ${width} day does not fit`);}
    }
    for(const route of ['/app/review?date=2026-10-13','/app/plans','/app/settings']){await page.goto(`${base}${route}&lang=${lang}`.replace('s&','s?'));await page.locator('main').first().waitFor();assert.equal(await overflow(page),false,`${lang} ${width} ${route} overflow`);}
  }
  checks.push('signed in: day/week/month, review, plans, settings at 7 widths × ko/en without overflow; header fits; the day fits the screen from 1024px');

  // 오늘 시간표로: from any screen, the header button lands on today's day view with the timetable right under the sticky header.
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/app/settings?lang=ko');await page.locator('.now-jump').click();
  await page.waitForURL(u=>u.searchParams.get('view')==='day');await page.locator('.journal-grid,.journal-activity-list').first().waitFor();await page.waitForTimeout(900);
  const fit=await page.evaluate(()=>({head:document.querySelector('.app-header').getBoundingClientRect(),grid:document.querySelector('.journal-schedule').getBoundingClientRect().top,date:new URLSearchParams(location.search).get('date'),today:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())}));
  assert.equal(fit.head.top,0,'header stays at the top');assert.equal(fit.date,fit.today);assert.ok(fit.grid>=fit.head.bottom&&fit.grid<fit.head.bottom+40,`timetable under the header (${fit.grid} vs ${fit.head.bottom})`);
  checks.push('오늘 시간표로 jumps to today and fits the timetable under the sticky header');

  // Notes save and come back after reload; a save from another device keeps this device's draft.
  await page.setViewportSize({width:1440,height:900});await page.goto(base+'/app?date=2026-10-13&lang=ko');
  const ideas=page.getByLabel('아이디어',{exact:true}).first();await ideas.fill('새로고침 뒤에도 남아요');await page.getByText('서버에 저장됨',{exact:true}).waitFor();
  await page.reload();await page.waitForFunction(()=>[...document.querySelectorAll('textarea')].some(t=>t.value==='새로고침 뒤에도 남아요'),null,{timeout:5000});
  // A save that fails while offline goes through by itself once the connection is back.
  await page.route('**/api/days/2026-10-13',r=>r.request().method()==='PUT'?r.abort('internetdisconnected'):r.continue());
  await ideas.fill('연결이 끊겨도 다시 저장돼요');await page.getByText('저장 실패 · 기기 초안 보관',{exact:true}).waitFor();
  await page.unroute('**/api/days/2026-10-13');await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.getByText('서버에 저장됨',{exact:true}).waitFor();
  assert.equal((await (await context.request.get(base+'/api/days/2026-10-13')).json()).document.notes.ideas,'연결이 끊겨도 다시 저장돼요');
  const saved=await (await context.request.get(base+'/api/days/2026-10-13')).json();saved.document.notes.ideas='다른 기기에서 먼저 작성';
  assert.equal((await context.request.put(base+'/api/days/2026-10-13',{headers,data:{version:saved.version,document:saved.document}})).status(),200);
  await page.getByLabel('아이디어',{exact:true}).first().fill('이 기기 초안은 남아요');await page.getByText('다른 기기 변경 확인 필요',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('아이디어',{exact:true}).first().inputValue(),'이 기기 초안은 남아요');
  checks.push('notes save/reload; a failed save retries when back online; a conflicting save from another device keeps the local draft');

  // A failed sign-in message follows the language switch and the typed email stays.
  const guest=await browser.newPage();guest.on('pageerror',e=>errors.push(e.message));await guest.goto(base+'/login?lang=en');
  await guest.getByLabel('Email',{exact:true}).fill('nobody@example.test');await guest.getByLabel('Password',{exact:true}).fill('temporary-wrong-password');await guest.getByRole('button',{name:'Log in',exact:true}).click();
  await guest.getByRole('alert').waitFor();const english=await guest.getByRole('alert').textContent();assert.ok(!/[가-힣]/.test(english),english);
  await guest.getByRole('combobox',{name:'Language'}).first().selectOption('ko');assert.ok(/[가-힣]/.test(await guest.getByRole('alert').textContent()));assert.equal(await guest.getByLabel('이메일',{exact:true}).inputValue(),'nobody@example.test');
  checks.push('sign-in error translates en→ko and keeps the typed email');

  assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await app.close();await rm(temp,{recursive:true,force:true});}
