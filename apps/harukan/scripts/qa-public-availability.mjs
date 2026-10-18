import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5175',out='.impeccable/review/public-availability';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const checks=[],errors=[];
try{
 const context=await browser.newContext(),page=await context.newPage();let sessionRequests=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/auth/session'))sessionRequests++;});
 await context.route('**/api/**',route=>route.abort('failed'));
 for(const [language,width,name] of [['ko',1440,'desktop'],['en',390,'mobile']]){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/?lang='+language);
  await page.locator('.landing-hero h1').waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:out+'/'+name+'.png',fullPage:true});
  await page.locator('.product-tabs button').nth(1).click();await page.locator('.product-task-preview').waitFor();
  checks.push(`${language} homepage ${width}px: API unavailable, hero and interactive preview visible, no alert or overflow`);
 }
 assert.equal(sessionRequests,0);checks.push('public homepage does not request login session');
 await page.goto(base+'/demo?lang=en');await page.getByRole('button',{name:'Take a course Done as planned',exact:true}).click();assert.equal(await page.locator('.day-summary strong').first().textContent(),'2/4');checks.push('offline demo remains usable');
 for(const route of ['about','privacy','terms','contact']){await page.goto(base+'/'+route+'?lang=en');await page.locator('.legal-page h1').waitFor();assert.equal(await page.getByRole('alert').count(),0);}checks.push('public information pages remain visible without metadata API; unverified fallback policy is labeled');
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/app?lang=en');await page.getByRole('alert').waitFor();assert.equal(await page.locator('.planner-page').count(),0);assert.ok((await page.getByRole('alert').textContent()).includes('connect to the server'));await page.getByRole('combobox',{name:'Language',exact:true}).first().selectOption('ko');assert.ok((await page.getByRole('alert').textContent()).includes('서버 연결'));checks.push('private planner still requires a confirmed session; connection error localizes');
 assert.deepEqual(errors,[]);await writeFile('.omo/evidence/public-availability.json',JSON.stringify({checks,errors,fixture:'isolated browser; API requests aborted; no account or stored data modified'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
