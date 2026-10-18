import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeApp} from '../server/app.mjs';

// Input and volume limits: what one person (or a script) can put on the server.
async function setup(t,options={}){
  const dataDirectory=await mkdtemp(join(tmpdir(),'harukan-limits-'));
  const app=makeApp({dataDirectory,origin:'http://planner.test',registration:true,mailer:async()=>{},...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await app.close();await rm(dataDirectory,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${app.server.address().port}`;let cookie='',csrf='';
  const send=async(path,method='GET',body)=>{const res=await fetch(url+path,{method,headers:{Origin:'http://planner.test','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];if(value.csrf)csrf=value.csrf;return {status:res.status,value};};
  const register=(nickname,email='limits@example.test')=>send('/api/auth/register','POST',{email,nickname,password:'limits-test-password',termsVersion:'2026-10-18',ageConfirmed:true});
  return {send,register};
}
const day=(notes='')=>({plans:[],entries:[],priorities:[],notes:{thoughts:notes,ideas:'',review:''}});

test('sign-up rejects long or disguised nicknames and long emails', async t=>{
  const {register}=await setup(t);
  for(const nickname of ['a','가'.repeat(21),'ab\u202ecd','zero\u200bwidth'])assert.equal((await register(nickname)).status,400,JSON.stringify(nickname));
  assert.equal((await register('ok','x'.repeat(65)+'@example.test')).status,400);
  assert.equal((await register('이모지 😀 닉네임')).status,201);
});

test('one account cannot store more than its share', async t=>{
  const {send,register}=await setup(t,{storageLimit:50000});
  assert.equal((await register('storage')).status,201);
  assert.equal((await send('/api/days/2026-10-01','PUT',{version:0,document:day('a'.repeat(19000))})).status,200);
  assert.equal((await send('/api/days/2026-10-02','PUT',{version:0,document:day('b'.repeat(19000))})).status,200);
  const full=await send('/api/days/2026-10-03','PUT',{version:0,document:day('c'.repeat(19000))});
  assert.equal(full.status,413);assert.match(full.value.message,/저장 공간/);
  // Rewriting an existing day counts that day once, so shrinking or editing still works.
  assert.equal((await send('/api/days/2026-10-02','PUT',{version:1,document:day('short')})).status,200);
  assert.equal((await send('/api/days/2026-10-03','PUT',{version:0,document:day('c'.repeat(19000))})).status,200);
});

test('writes per account are rate limited', async t=>{
  const {send,register}=await setup(t,{writeLimit:5});
  assert.equal((await register('writer')).status,201);
  let version=0;for(let i=0;i<5;i++){const r=await send('/api/days/2026-10-01','PUT',{version,document:day(String(i))});assert.equal(r.status,200);version=r.value.version;}
  assert.equal((await send('/api/days/2026-10-01','PUT',{version,document:day('again')})).status,429);
  assert.equal((await send('/api/days/2026-10-01')).status,200);
});

test('a session lasts 30 days from the last visit', async t=>{
  let now=Date.parse('2026-10-18T00:00:00Z');
  const {send,register}=await setup(t,{clock:()=>now});
  assert.equal((await register('stay')).status,201);
  now+=20*86400000;assert.ok((await send('/api/auth/session')).value.user,'still signed in after 20 days');
  now+=25*86400000;assert.ok((await send('/api/auth/session')).value.user,'renewed at day 20, so day 45 is fine');
  now+=31*86400000;assert.equal((await send('/api/auth/session')).value.user,null);
});

test('time zone: set from the browser at sign-up, changeable, validated', async t=>{
  const {send}=await setup(t);
  const r=await send('/api/auth/register','POST',{email:'zone@example.test',nickname:'zone',password:'limits-test-password',termsVersion:'2026-10-18',ageConfirmed:true,timezone:'America/Los_Angeles'});
  assert.equal(r.value.user.timezone,'America/Los_Angeles');
  assert.equal((await send('/api/account/timezone','POST',{timezone:'Mars/Olympus'})).status,400);
  assert.equal((await send('/api/account/timezone','POST',{timezone:'Asia/Tokyo'})).value.user.timezone,'Asia/Tokyo');
  assert.equal((await send('/api/auth/session')).value.user.timezone,'Asia/Tokyo');
});
test('an unknown time zone at sign-up falls back to Seoul', async t=>{
  const {send}=await setup(t);
  const r=await send('/api/auth/register','POST',{email:'zone2@example.test',nickname:'zone',password:'limits-test-password',termsVersion:'2026-10-18',ageConfirmed:true,timezone:'nope'});
  assert.equal(r.value.user.timezone,'Asia/Seoul');
});
