// Account screens end to end: sign up with email + nickname, nickname in the header and settings,
// forgot → reset link → sign in with the new password, and the email check link. Mail is captured, not sent.
// Isolated temporary account and DB on port 8801.
import {chromium} from 'playwright-core';
import {makeApp} from '../server/app.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const dir=await mkdtemp(join(tmpdir(),'harukan-account-')),base='http://127.0.0.1:8801',mail=[];
const app=makeApp({dataDirectory:dir,origin:base,registration:true,legalReviewed:true,legal:{publishedAt:'2026-10-12',hostingRegion:'Osaka'},mailer:async m=>{mail.push(m);}});
await new Promise(r=>app.server.listen(8801,'127.0.0.1',r));
const link=(to,kind)=>mail.filter(m=>m.to===to&&m.text.includes(`/${kind}?token=`)).at(-1)?.text.match(/https?:\/\/\S+/)[0];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),checks=[],errors=[];
try{
  const page=await (await browser.newContext({viewport:{width:1280,height:900}})).newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/signup?lang=ko');
  await page.getByLabel('이메일',{exact:true}).fill('qa.person@example.test');await page.getByLabel('닉네임',{exact:true}).fill('하루 사람');
  await page.getByLabel('비밀번호',{exact:true}).fill('account-qa-password');
  for(const box of await page.locator('.auth-consents input[type=checkbox]').all())await box.check();
  await page.getByRole('button',{name:'가입하고 시작하기'}).click();await page.waitForURL('**/app**');
  await page.locator('.account-link',{hasText:'하루 사람'}).waitFor();checks.push('sign-up with email + nickname lands on the app with the nickname in the header');
  assert.ok(link('qa.person@example.test','verify'));checks.push('sign-up sends an email check link');

  await page.goto(base+'/app/settings');await page.locator('.account-value .unverified').waitFor();
  await page.getByLabel('닉네임',{exact:true}).fill('새 닉네임');await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.locator('.account-link',{hasText:'새 닉네임'}).waitFor();checks.push('settings changes the nickname and the header follows');

  await page.goto(link('qa.person@example.test','verify'));await page.getByText('주소를 확인했어요').waitFor();
  await page.goto(base+'/app/settings');await page.locator('.account-value .verified').waitFor();checks.push('the check link confirms the address');

  await page.getByRole('button',{name:'로그아웃'}).click();await page.waitForURL(u=>!u.pathname.startsWith('/app'));
  await page.goto(base+'/forgot');await page.getByLabel('이메일',{exact:true}).fill('qa.person@example.test');
  await page.getByRole('button',{name:'재설정 링크 보내기'}).click();await page.getByText('재설정 링크를 보냈어요').waitFor();
  const reset=link('qa.person@example.test','reset');assert.ok(reset);
  await page.goto(reset);await page.getByLabel('새 비밀번호',{exact:true}).fill('account-qa-password-2');
  await page.getByRole('button',{name:'비밀번호 재설정'}).click();await page.waitForURL('**/app**');checks.push('forgot → reset link → new password signs in');
  await page.goto(reset);await page.getByLabel('새 비밀번호',{exact:true}).fill('account-qa-password-3');
  await page.getByRole('button',{name:'비밀번호 재설정'}).click();await page.getByText('만료됐거나 이미 쓴 링크예요').waitFor();checks.push('a reset link works once');

  await page.goto(base+'/app/settings');await page.getByRole('button',{name:'로그아웃'}).click();await page.waitForURL(u=>!u.pathname.startsWith('/app'));
  await page.goto(base+'/login');await page.getByLabel('이메일',{exact:true}).fill('qa.person@example.test');
  await page.getByLabel('비밀번호',{exact:true}).fill('account-qa-password');await page.getByRole('button',{name:'로그인',exact:true}).click();
  await page.getByText('이메일 또는 비밀번호를 확인해 주세요').waitFor();
  await page.getByLabel('비밀번호',{exact:true}).fill('account-qa-password-2');await page.getByRole('button',{name:'로그인',exact:true}).click();
  await page.waitForURL('**/app**');checks.push('the old password is refused, the new one signs in');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks},null,2));
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
