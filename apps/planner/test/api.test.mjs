import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeApp} from '../server/app.mjs';
import {emptyDay} from '../server/store.mjs';

const password='planner-test-password-only';
async function fixture(t,options={}){
  const dataDirectory=await mkdtemp(join(tmpdir(),'anotar-planner-test-'));
  const app=makeApp({dataDirectory,origin:'http://planner.test',registration:true,...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await app.close();await rm(dataDirectory,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${app.server.address().port}`;
  function client(){let cookie='',csrf='';return{async send(path,method='GET',body,headers={}){
    const res=await fetch(url+path,{method,headers:{Origin:'http://planner.test',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const value=await res.json();if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];if(value.csrf)csrf=value.csrf;
    return {status:res.status,value,headers:res.headers};
  },get cookie(){return cookie;},get csrf(){return csrf;}};}
  async function register(c,username){return c.send('/api/auth/register','POST',{username,password,termsVersion:'2026-10-11-v1',ageConfirmed:true});}
  return{...app,client,register};
}
test('accounts isolate records and export; writes require Origin and CSRF; deletion cascades',async t=>{
  const {client,register,db}=await fixture(t),a=client(),b=client();
  assert.equal((await a.send('/api/days/2026-10-11')).status,401);
  const ra=await register(a,'alice_test');assert.equal(ra.status,201);
  assert.match(ra.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  const stored=db.prepare('SELECT password,recovery_hash FROM users WHERE username=?').get('alice_test');
  assert.notEqual(stored.password,password);assert.notEqual(stored.recovery_hash,ra.value.recoveryCode);
  assert.equal((await register(b,'bob_test')).status,201);
  const doc=emptyDay();doc.plans.push({id:'read',title:'비공개 계획',start:540,end:600,status:'pending'});
  assert.equal((await a.send('/api/days/2026-10-11','PUT',{version:0,document:doc},{Origin:'http://evil.test'})).status,403);
  assert.equal((await a.send('/api/days/2026-10-11','PUT',{version:0,document:doc},{'X-CSRF-Token':''})).status,403);
  assert.equal((await a.send('/api/days/2026-10-11','PUT',{version:0,document:doc})).status,200);
  assert.deepEqual((await b.send('/api/days/2026-10-11')).value.document,emptyDay());
  assert.equal((await b.send('/api/export')).value.days.length,0);
  const exported=(await a.send('/api/export')).value;assert.equal(exported.days.length,1);assert.equal(JSON.stringify(exported).includes(stored.password),false);
  assert.equal((await a.send('/api/account','DELETE',{confirmation:'bob_test',password})).status,400);
  assert.equal((await a.send('/api/account','DELETE',{confirmation:'alice_test',password})).status,200);
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
test('recovery codes are one-use even for concurrent requests and revoke older sessions',async t=>{
  const {client,register}=await fixture(t),a=client(),other=client();const r=await register(a,'recovery_test');
  assert.equal((await other.send('/api/auth/login','POST',{username:'recovery_test',password})).status,200);
  const recover=client(),next=client();const data={username:'recovery_test',password:'replacement-password-2026',recoveryCode:r.value.recoveryCode};
  const results=await Promise.all([recover.send('/api/auth/recover','POST',data),next.send('/api/auth/recover','POST',data)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
  assert.equal((await a.send('/api/export')).status,401);assert.equal((await other.send('/api/export')).status,401);
  assert.equal((await client().send('/api/auth/login','POST',{username:'recovery_test',password})).status,401);
});
test('password rotation revokes other sessions and invalid credentials do not reveal accounts',async t=>{
  const {client,register}=await fixture(t),a=client(),b=client();await register(a,'password_test');await b.send('/api/auth/login','POST',{username:'password_test',password});
  assert.equal((await a.send('/api/account/password','POST',{currentPassword:password,password:'brand-new-password-test'})).status,200);
  assert.equal((await b.send('/api/export')).status,401);assert.equal((await a.send('/api/export')).status,200);
  const missing=await client().send('/api/auth/login','POST',{username:'missing_user',password}),wrong=await client().send('/api/auth/login','POST',{username:'password_test',password});
  assert.equal(missing.value.message,wrong.value.message);
});
test('production registration stays closed without finalized actual legal information',async t=>{
  const {client}=await fixture(t,{production:true,origin:'https://leneu.store'}),c=client();
  const site=(await c.send('/api/site')).value;assert.equal(site.registration,false);assert.equal(site.legalReady,false);
  assert.equal((await c.send('/api/auth/register','POST',{username:'prod_test',password,termsVersion:'2026-10-11-v1',ageConfirmed:true},{Origin:'https://leneu.store'})).status,403);
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
 const user=db.prepare('SELECT id FROM users WHERE username=?').get('period_test');
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
