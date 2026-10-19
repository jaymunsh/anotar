import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {makeApp} from '../server/app.mjs';
import {emptyDay} from '../server/store.mjs';

const password='planner-test-password-only';
async function fixture(t,options={}){
  const dataDirectory=await mkdtemp(join(tmpdir(),'anotar-planner-test-'));
  const mail=[];
  const app=makeApp({verifySignups:false,dataDirectory,origin:'http://planner.test',registration:true,mailer:async m=>{mail.push(m);},...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await app.close();await rm(dataDirectory,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${app.server.address().port}`;
  function client(){let cookie='',csrf='';return{async send(path,method='GET',body,headers={}){
    const res=await fetch(url+path,{method,headers:{Origin:'http://planner.test',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const value=await res.json();if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];if(value.csrf)csrf=value.csrf;
    return {status:res.status,value,headers:res.headers};
  },get cookie(){return cookie;},get csrf(){return csrf;}};}
  const email=name=>`${name}@example.test`;
  async function register(c,name){return c.send('/api/auth/register','POST',{email:email(name),nickname:name.slice(0,20),password,termsVersion:'2026-10-18',ageConfirmed:true});}
  // The link in the newest mail to someone, e.g. /reset?token=…
  const linkTo=to=>mail.filter(m=>m.to===to).at(-1)?.text.match(/\/(verify|reset)\?token=([\w-]+)/);
  return{...app,client,register,email,mail,linkTo,dataDirectory};
}
test('accounts isolate records and export; writes require Origin and CSRF; deletion cascades',async t=>{
  const {client,register,db}=await fixture(t),a=client(),b=client();
  assert.equal((await a.send('/api/days/2026-10-11')).status,401);
  const ra=await register(a,'alice_test');assert.equal(ra.status,201);
  assert.match(ra.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  const stored=db.prepare('SELECT password,nickname FROM users WHERE email=?').get('alice_test@example.test');
  assert.notEqual(stored.password,password);assert.equal(stored.nickname,'alice_test');assert.equal(ra.value.user.emailVerified,false);
  assert.equal((await register(b,'bob_test')).status,201);
  const doc=emptyDay();doc.plans.push({id:'read',title:'비공개 계획',start:540,end:600,status:'pending'});
  assert.equal((await a.send('/api/days/2026-10-11','PUT',{version:0,document:doc},{Origin:'http://evil.test'})).status,403);
  assert.equal((await a.send('/api/days/2026-10-11','PUT',{version:0,document:doc},{'X-CSRF-Token':''})).status,403);
  assert.equal((await a.send('/api/days/2026-10-11','PUT',{version:0,document:doc})).status,200);
  assert.deepEqual((await b.send('/api/days/2026-10-11')).value.document,emptyDay());
  assert.equal((await b.send('/api/export')).value.days.length,0);
  const exported=(await a.send('/api/export')).value;assert.equal(exported.days.length,1);assert.equal(JSON.stringify(exported).includes(stored.password),false);
  assert.equal((await a.send('/api/account','DELETE',{confirmation:'bob_test@example.test',password})).status,400);
  assert.equal((await a.send('/api/account','DELETE',{confirmation:'alice_test@example.test',password})).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM days').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
  assert.equal((await a.send('/api/export')).status,401);
});
test('optimistic conflicts preserve saved data and priority links stay within the day',async t=>{
  const {client,register}=await fixture(t),a=client(),b=client();await register(a,'alice_task');await register(b,'bob_task');
  const doc=emptyDay();doc.plans=[{id:'plan',title:'계획',start:100,end:200,status:'pending',priorityId:'missing'}];
  assert.equal((await a.send('/api/days/2026-10-11','PUT',{version:0,document:doc})).status,400);
  delete doc.plans[0].priorityId;
  const results=await Promise.all([a.send('/api/days/2026-10-11','PUT',{version:0,document:doc}),a.send('/api/days/2026-10-11','PUT',{version:0,document:{...doc,notes:{...doc.notes,review:'stale'}}})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await a.send('/api/days/2026-10-11')).value.version,1);
  doc.entries=[{id:'plan',title:'중복 ID',start:200,end:300}];assert.equal((await a.send('/api/days/2026-10-11','PUT',{version:1,document:doc})).status,400);
  assert.equal((await a.send('/api/days/2026-02-30')).status,400);
});
test('sign-in is by email only; the internal username is not a login',async t=>{
  const {client,register,db}=await fixture(t),a=client();await register(a,'email_only');
  const {username}=db.prepare('SELECT username FROM users WHERE email=?').get('email_only@example.test');
  assert.equal((await client().send('/api/auth/login','POST',{login:username,password})).status,401);
  assert.equal((await client().send('/api/auth/login','POST',{login:'EMAIL_ONLY@example.test',password})).status,200);
  assert.equal((await client().send('/api/auth/recover','POST',{username,password,recoveryCode:'x'})).status,401,'no recovery route: an unknown path asks for sign-in');
});
test('password rotation revokes other sessions and invalid credentials do not reveal accounts',async t=>{
  const {client,register}=await fixture(t),a=client(),b=client();await register(a,'password_test');await b.send('/api/auth/login','POST',{login:'password_test@example.test',password});
  assert.equal((await a.send('/api/account/password','POST',{currentPassword:password,password:'brand-new-password-test'})).status,200);
  assert.equal((await b.send('/api/export')).status,401);assert.equal((await a.send('/api/export')).status,200);
  const missing=await client().send('/api/auth/login','POST',{login:'missing_user@example.test',password}),wrong=await client().send('/api/auth/login','POST',{login:'password_test@example.test',password});
  assert.equal(missing.value.message,wrong.value.message);
});
test('production registration stays closed without finalized actual legal information',async t=>{
  const {client}=await fixture(t,{production:true,origin:'https://leneu.store'}),c=client();
  const site=(await c.send('/api/site')).value;assert.equal(site.registration,false);assert.equal(site.legalReady,false);
  assert.equal((await c.send('/api/auth/register','POST',{email:'prod_test@example.test',nickname:'prod',password,termsVersion:'2026-10-18',ageConfirmed:true},{Origin:'https://leneu.store'})).status,403);
});

test('journal priorities and unfinished plans persist without changing legacy records',async t=>{
 const {client,register}=await fixture(t),a=client(),b=client();await register(a,'journal_test');await register(b,'journal_other');
 const legacy=emptyDay();legacy.plans=[{id:'legacy',title:'Legacy minute precision',start:101,end:137,status:'partial'}];legacy.entries=[{id:'actual',title:'Original actual',start:104,end:140,planId:'legacy'}];legacy.notes.ideas='Original note';
 assert.equal((await a.send('/api/days/2026-10-12','PUT',{version:0,document:legacy})).status,200);
 assert.deepEqual((await a.send('/api/days/2026-10-12')).value.document,legacy);
 const updated=structuredClone(legacy);updated.priorities=[{id:'priority',text:'My task',done:true,steps:[{id:'step',text:'First step',done:false}]}];updated.plans.push({id:'new',title:'Unfinished',start:540,end:570,status:'missed',priorityId:'priority'});
 assert.equal((await a.send('/api/days/2026-10-12','PUT',{version:1,document:updated})).status,200);
 assert.deepEqual((await a.send('/api/days/2026-10-12')).value.document,updated);assert.equal((await b.send('/api/export')).value.days.length,0);
 const invalid=structuredClone(updated);invalid.plans[1].priorityId='missing';assert.equal((await a.send('/api/days/2026-10-12','PUT',{version:2,document:invalid})).status,400);
 invalid.plans[1].priorityId='priority';invalid.priorities.push({...invalid.priorities[0]});assert.equal((await a.send('/api/days/2026-10-12','PUT',{version:2,document:invalid})).status,400);
 const badStep=structuredClone(updated);badStep.priorities[0].steps[0].done='no';assert.equal((await a.send('/api/days/2026-10-12','PUT',{version:2,document:badStep})).status,400);
 assert.deepEqual((await a.send('/api/days/2026-10-12')).value.document,updated);
});

test('period lookup includes historical full-year records, validates ranges and isolates accounts',async t=>{
 const {client,register,db}=await fixture(t),a=client(),b=client();await register(a,'period_test');await register(b,'period_other');
 const user=db.prepare('SELECT id FROM users WHERE email=?').get('period_test@example.test');
 const insert=db.prepare('INSERT INTO days(user_id,date,document,version,updated_at) VALUES(?,?,?,?,?)');
 for(let i=0;i<450;i++){const d=new Date('2024-01-01T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);insert.run(user.id,d.toISOString().slice(0,10),JSON.stringify(emptyDay()),1,new Date().toISOString());}
 assert.equal((await a.send('/api/days')).value.items.length,400);
 const annual=await a.send('/api/days?from=2024-01-01&to=2024-12-31');assert.equal(annual.status,200);assert.equal(annual.value.items.length,366);assert.ok(annual.value.items.some(x=>x.date==='2024-01-01'));
 assert.equal((await b.send('/api/days?from=2024-01-01&to=2024-12-31')).value.items.length,0);
 for(const query of ['from=2024-02-30&to=2024-12-31','from=2024-01-01','from=2024-01-01&to=2025-12-31','from=2024-12-31&to=2024-01-01'])assert.equal((await a.send('/api/days?'+query)).status,400);
});
test('activity planningId keeps only the owner’s existing planning item and survives its deletion',async t=>{
  const {client,register}=await fixture(t),a=client(),b=client();await register(a,'alice_tag');await register(b,'bob_tag');
  const goal={kind:'goal',title:'작게 공개하기',startMonth:'2026-10',endMonth:'2026-12',note:'',parentId:null,version:0};
  assert.equal((await a.send('/api/planning/goal','PUT',goal)).status,200);
  const day=planningId=>{const doc=emptyDay();doc.plans=[{id:'p1',title:'체크리스트',start:540,end:600,status:'pending',planningId}];return doc;};
  assert.equal((await a.send('/api/days/2026-10-12','PUT',{version:0,document:day('goal')})).status,200);
  assert.equal((await a.send('/api/days/2026-10-12')).value.document.plans[0].planningId,'goal');
  assert.equal((await b.send('/api/days/2026-10-12','PUT',{version:0,document:day('goal')})).status,200);
  assert.equal(Object.hasOwn((await b.send('/api/days/2026-10-12')).value.document.plans[0],'planningId'),false);
  assert.equal((await a.send('/api/days/2026-10-13','PUT',{version:0,document:day('bad id!')})).status,400);
  assert.equal((await a.send('/api/planning/goal','DELETE',{version:1})).status,200);
  const saved=(await a.send('/api/days/2026-10-12')).value;
  assert.equal(saved.document.plans[0].title,'체크리스트');
  assert.equal((await a.send('/api/days/2026-10-12','PUT',{version:saved.version,document:saved.document})).status,200);
  assert.equal(Object.hasOwn((await a.send('/api/days/2026-10-12')).value.document.plans[0],'planningId'),false);
});
test('routines are named entries in planning, owner-only, with version checks',async t=>{
  const {client,register}=await fixture(t),a=client(),b=client();await register(a,'alice_routine');await register(b,'bob_routine');
  const saved=await a.send('/api/planning/r1','PUT',{kind:'routine',title:'  운동  ',version:0});
  assert.equal(saved.status,200);assert.deepEqual(saved.value,{kind:'routine',title:'운동',id:'r1',version:1});
  assert.equal((await a.send('/api/planning/r1','PUT',{kind:'routine',title:'운동 30분',version:0})).status,409);
  assert.equal((await a.send('/api/planning/r1','PUT',{kind:'routine',title:'',version:1})).status,400);
  assert.equal((await a.send('/api/planning/r1','PUT',{kind:'goal',title:'목표',startMonth:'2026-10',endMonth:'2026-10',note:'',parentId:null,version:1})).status,400);
  assert.deepEqual((await a.send('/api/planning')).value.items,[{kind:'routine',title:'운동',id:'r1',version:1}]);
  assert.deepEqual((await b.send('/api/planning')).value.items,[]);
  assert.equal((await a.send('/api/planning/r1','DELETE',{version:1})).status,200);
  assert.deepEqual((await a.send('/api/planning')).value.items,[]);
});
test('day templates keep sorted, valid timed blocks, owner-only, with version checks',async t=>{
  const {client,register}=await fixture(t),a=client(),b=client();await register(a,'alice_template');await register(b,'bob_template');
  const saved=await a.send('/api/planning/t1','PUT',{kind:'template',title:' 평일 ',blocks:[{title:'운동',start:1080,end:1140},{title:' 알고리즘 ',start:540,end:660}],version:0});
  assert.equal(saved.status,200);assert.deepEqual(saved.value,{kind:'template',title:'평일',blocks:[{title:'알고리즘',start:540,end:660},{title:'운동',start:1080,end:1140}],id:'t1',version:1});
  for(const blocks of [[{title:'x',start:600,end:600}],[{title:'',start:0,end:10}],[{title:'x',start:-10,end:10}],[{title:'x',start:0,end:1450}],'nope'])assert.equal((await a.send('/api/planning/t1','PUT',{kind:'template',title:'평일',blocks,version:1})).status,400);
  assert.equal((await a.send('/api/planning/t1','PUT',{kind:'template',title:'평일',blocks:[],version:0})).status,409);
  assert.equal((await a.send('/api/planning/t1','PUT',{kind:'routine',title:'평일',version:1})).status,400);
  assert.deepEqual((await b.send('/api/planning')).value.items,[]);
  assert.equal((await a.send('/api/planning/t1','DELETE',{version:1})).status,200);
});

test('email sign-in: check link, reset link (one use, ends other sessions), nickname, email change, no account probing',async t=>{
  const {client,register,email,mail,linkTo}=await fixture(t),a=client(),b=client(),c=client();
  assert.equal((await register(a,'mail_user')).status,201);
  assert.equal((await register(client(),'mail_user')).status,409);
  assert.equal((await client().send('/api/auth/register','POST',{email:'nope',nickname:'x',password,termsVersion:'2026-10-18',ageConfirmed:true})).status,400);
  const check=linkTo(email('mail_user'));assert.equal(check[1],'verify');
  assert.equal((await client().send('/api/auth/verify','POST',{token:check[2]})).status,200);
  assert.equal((await client().send('/api/auth/verify','POST',{token:check[2]})).status,400);
  assert.equal((await a.send('/api/auth/session')).value.user.emailVerified,true);
  assert.equal((await b.send('/api/auth/login','POST',{login:'MAIL_USER@example.test',password})).status,200);
  // Forgot: same answer for unknown addresses, and only real accounts get mail.
  const before=mail.length;
  assert.equal((await c.send('/api/auth/forgot','POST',{email:'nobody@example.test'})).status,200);assert.equal(mail.length,before);
  assert.equal((await c.send('/api/auth/forgot','POST',{email:email('mail_user')})).status,200);
  const reset=linkTo(email('mail_user'));assert.equal(reset[1],'reset');
  assert.equal((await c.send('/api/auth/reset','POST',{token:reset[2],password:'short'})).status,400);
  assert.equal((await c.send('/api/auth/reset','POST',{token:reset[2],password:'a-brand-new-password'})).status,200);
  assert.equal((await c.send('/api/auth/reset','POST',{token:reset[2],password:'another-new-password'})).status,400);
  assert.equal((await a.send('/api/export')).status,401);assert.equal((await b.send('/api/export')).status,401);
  assert.equal((await client().send('/api/auth/login','POST',{login:email('mail_user'),password:'a-brand-new-password'})).status,200);
  // Nickname and a new address (it changes only once its link is opened; taken addresses are refused).
  assert.equal((await c.send('/api/account/profile','POST',{nickname:'  하루  칸 '})).value.user.nickname,'하루 칸');
  assert.equal((await c.send('/api/account/profile','POST',{nickname:'x'})).status,400);
  await register(client(),'other_user');
  assert.equal((await c.send('/api/account/email','POST',{email:email('other_user')})).status,409);
  assert.equal((await c.send('/api/account/email','POST',{email:'moved@example.test'})).status,200);
  assert.equal((await c.send('/api/auth/session')).value.user.email,email('mail_user'));
  assert.equal((await client().send('/api/auth/verify','POST',{token:linkTo('moved@example.test')[2]})).status,200);
  assert.equal((await c.send('/api/auth/session')).value.user.email,'moved@example.test');
  assert.equal((await client().send('/api/auth/login','POST',{login:'moved@example.test',password:'a-brand-new-password'})).status,200);
});
test('a new account is usable only after its email link; unconfirmed sign-ups are replaced or dropped after a day',async t=>{
  let now=Date.parse('2026-10-20T00:00:00Z');
  const {client,register,email,mail,linkTo,db,dataDirectory}=await fixture(t,{verifySignups:true,clock:()=>now}),a=client();
  const signed=await register(a,'confirm_me');assert.equal(signed.status,201);assert.equal(signed.value.pending,true);assert.equal(a.cookie,'');
  const login=()=>client().send('/api/auth/login','POST',{login:email('confirm_me'),password});
  const refused=await login();assert.equal(refused.status,403);assert.equal(refused.value.code,'unverified');
  // Wrong password still says nothing about the account.
  assert.equal((await client().send('/api/auth/login','POST',{login:email('confirm_me'),password:'not-the-right-password'})).status,401);
  const before=mail.length;assert.equal((await client().send('/api/auth/resend','POST',{email:email('confirm_me')})).status,200);assert.equal(mail.length,before+1);
  assert.equal((await client().send('/api/auth/resend','POST',{email:email('nobody_here')})).status,200);assert.equal(mail.length,before+1);
  // Only the newest link works, and opening it signs in.
  const opener=client(),opened=await opener.send('/api/auth/verify','POST',{token:linkTo(email('confirm_me'))[2]});
  assert.equal(opened.status,200);assert.equal(opened.value.user.emailVerified,true);assert.equal((await opener.send('/api/auth/session')).value.user.nickname,'confirm_me');
  assert.equal((await login()).status,200);
  assert.equal((await register(client(),'confirm_me')).status,409);
  // Someone else's unconfirmed sign-up does not hold the address: signing up again replaces it.
  assert.equal((await register(client(),'squat')).status,201);const first=db.prepare('SELECT id FROM users WHERE email=?').get(email('squat')).id;
  assert.equal((await register(client(),'squat')).status,201);assert.notEqual(db.prepare('SELECT id FROM users WHERE email=?').get(email('squat')).id,first);
  // A day later (the next cleanup) the unconfirmed one is gone; the confirmed one stays.
  const later=makeApp({dataDirectory,origin:'http://planner.test',clock:()=>now+86400000+1,mailer:async()=>{}});t.after(()=>later.close());
  assert.equal(later.db.prepare('SELECT 1 FROM users WHERE email=?').get(email('squat')),undefined);
  assert.ok(later.db.prepare('SELECT 1 FROM users WHERE email=?').get(email('confirm_me')));
});
