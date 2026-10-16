import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeApp} from '../server/app.mjs';

test('planning persists goals and steps with owner, CSRF, version and parent protection',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'anotar-planning-'));
 const app=makeApp({dataDirectory:directory,origin:'http://planner.test',registration:true});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 function client(){let cookie='',csrf='';return async(path,method='GET',data,headers={})=>{
  const response=await fetch(base+path,{method,headers:{Origin:'http://planner.test',Cookie:cookie,'X-CSRF-Token':csrf,...(data?{'Content-Type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
  const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrf)csrf=value.csrf;return {status:response.status,value};
 };}
 const a=client(),b=client(),password='temporary-planning-password';
 assert.equal((await a('/api/planning')).status,401);
 await a('/api/auth/register','POST',{username:'planning_alice',password,termsVersion:'2026-10-11-v1',ageConfirmed:true});
 await b('/api/auth/register','POST',{username:'planning_bob',password,termsVersion:'2026-10-11-v1',ageConfirmed:true});
 assert.equal((await a('/api/tasks')).status,410);assert.equal((await a('/api/tasks/task','PUT',{title:'Removed task',status:'todo',version:0})).status,410);
 const goal={kind:'goal',title:'Release the service',startMonth:'2026-01',endMonth:'2026-12',note:'A useful first release',parentId:null,version:0};
 assert.equal((await a('/api/planning/goal','PUT',goal,{'X-CSRF-Token':''})).status,403);
 assert.equal((await a('/api/planning/goal','PUT',goal,{Origin:'http://evil.test'})).status,403);
 assert.equal((await a('/api/planning/goal','PUT',goal)).status,200);
 assert.deepEqual((await b('/api/planning')).value.items,[]);
 assert.equal((await b('/api/planning/goal','DELETE',{version:1})).status,409);
 const step={...goal,kind:'step',title:'Usable on phones',parentId:'goal',startMonth:'2026-10',endMonth:'2026-11'};
 assert.equal((await b('/api/planning/foreign-step','PUT',step)).status,400);
 assert.equal((await a('/api/planning/step','PUT',{...step,startMonth:'2025-12'})).status,400);
 assert.equal((await a('/api/planning/step','PUT',{...step,endMonth:'2026-13'})).status,400);
 assert.equal((await a('/api/planning/step','PUT',step)).status,200);
 assert.equal((await a('/api/planning/step','PUT',{...step,version:0,title:'Stale overwrite'})).status,409);
 assert.equal((await a('/api/planning/goal','PUT',{...goal,version:1,endMonth:'2026-09'})).status,400);
 assert.equal((await a('/api/planning/goal','PUT',{...goal,version:1,kind:'step'})).status,400);
 const exported=(await a('/api/export')).value;assert.equal(exported.planning.length,2);assert.equal(Object.hasOwn(exported,'tasks'),false);
 assert.equal((await a('/api/planning/goal','DELETE',{version:0})).status,400);
 assert.equal((await a('/api/planning/goal','DELETE',{version:1})).status,200);
 const remaining=(await a('/api/planning')).value.items;assert.equal(remaining.length,1);assert.equal(remaining[0].id,'step');assert.equal(remaining[0].parentId,null);assert.equal(remaining[0].version,2);assert.equal(Object.hasOwn(remaining[0],'taskIds'),false);
 assert.equal((await a('/api/planning/step','PUT',{...step,parentId:null,version:1})).status,409);
 assert.equal((await a('/api/account','DELETE',{confirmation:'planning_alice',password})).status,200);
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM planning').get().n,0);
 assert.equal((await a('/api/planning')).status,401);
});
