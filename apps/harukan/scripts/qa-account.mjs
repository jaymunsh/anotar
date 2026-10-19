// Account screens end to end: sign up with email + nickname → check your inbox → the link signs in (signing in before it
// is refused, with a resend), nickname in the header and settings, forgot → reset link → sign in with the new password. Mail is captured, not sent.
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
  await page.getByRole('button',{name:'가입하고 시작하기'}).click();await page.getByText('메일함을 확인해 주세요').waitFor();
  assert.ok(!page.url().includes('/app'));assert.ok(link('qa.person@example.test','verify'));checks.push('sign-up shows check-your-inbox and sends a link, without signing in');
  // Signing in before the link is opened: refused, with a way to get another link.
  await page.goto(base+'/login');await page.getByLabel('이메일',{exact:true}).fill('qa.person@example.test');
  await page.getByLabel('비밀번호',{exact:true}).fill('account-qa-password');await page.getByRole('button',{name:'로그인',exact:true}).click();
  await page.getByText('이메일 확인이 필요해요').waitFor();const sent=mail.length;
  await page.getByRole('button',{name:'확인 메일 다시 받기'}).click();await page.getByText('확인 메일을 다시 보냈어요').waitFor();
  assert.equal(mail.length,sent+1);checks.push('signing in before confirming is refused and can resend the link');
  await page.goto(link('qa.person@example.test','verify'));await page.getByText('주소를 확인했어요').waitFor();
  await page.getByRole('link',{name:'시간표로 이동'}).click();await page.waitForURL('**/app**');
  await page.locator('.account-link',{hasText:'하루 사람'}).waitFor();checks.push('the link confirms the address and signs in, nickname in the header');

  await page.goto(base+'/app/settings');await page.locator('.account-value .verified').waitFor();
  await page.getByLabel('닉네임',{exact:true}).fill('새 닉네임');await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.locator('.account-link',{hasText:'새 닉네임'}).waitFor();checks.push('settings changes the nickname and the header follows');

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
  // Time zone: pick another zone, confirm, and the account keeps it.
  await page.goto(base+'/app/settings');page.once('dialog',d=>d.accept());await page.getByLabel('시간대').selectOption('Asia/Tokyo');await page.locator('form',{has:page.getByLabel('시간대')}).getByRole('button',{name:'바꾸기'}).click();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="시간대"]')?.value==='Asia/Tokyo');checks.push('settings changes the time zone');
  // Deleting the account: the button opens only for the account's own email.
  await page.getByText('계정과 기록 삭제').click();const remove=page.getByRole('button',{name:'탈퇴하고 기록 삭제'});
  await page.getByLabel('이메일을 다시 입력').fill('someone.else@example.test');assert.equal(await remove.isDisabled(),true);
  await page.getByLabel('이메일을 다시 입력').fill('QA.Person@example.test');await page.locator('details',{hasText:'계정과 기록 삭제'}).getByLabel('비밀번호').fill('account-qa-password-2');assert.equal(await remove.isDisabled(),false);
  page.once('dialog',d=>d.accept());await remove.click();await page.waitForURL(u=>u.pathname==='/');checks.push('account deletion with the email and password');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks},null,2));
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
