import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeApp} from '../server/app.mjs';

test('signed-in visitors skip the landing and sign-in pages; others still see them',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'anotar-home-'));
 const app=makeApp({dataDirectory:directory,origin:'http://planner.test',registration:true});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const get=(path,cookie='')=>fetch(base+path,{redirect:'manual',headers:{Cookie:cookie}});
 for(const path of ['/','/login','/signup'])assert.notEqual((await get(path)).status,302,path);
 const registered=await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:'http://planner.test','Content-Type':'application/json'},body:JSON.stringify({email:'home_alice@example.test',nickname:'home_alice',password:'temporary-home-password',termsVersion:'2026-10-11-v1',ageConfirmed:true})});
 const cookie=registered.headers.get('set-cookie').split(';')[0];
 for(const path of ['/','/login','/signup']){const response=await get(path,cookie);assert.equal(response.status,302,path);assert.equal(response.headers.get('location'),'/app');}
 for(const path of ['/guide','/about','/demo'])assert.notEqual((await get(path,cookie)).status,302,path);
});
