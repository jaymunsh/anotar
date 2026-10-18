import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {retireTasks} from '../server/retire-tasks.mjs';

test('explicit retirement removes task contents and links while preserving diary, priorities and goals',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'anotar-task-retirement-')),db=openStore(directory);
 try{
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='tasks'").get(),undefined);
  db.prepare('INSERT INTO users(id,username,password,recovery_hash,timezone,created_at,terms_version) VALUES(?,?,?,?,?,?,?)').run('u','tester','hash','recovery','Asia/Seoul',1,'terms');
  db.exec('CREATE TABLE tasks(id TEXT,user_id TEXT,title TEXT,status TEXT,version INTEGER,updated_at INTEGER)');
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?)').run('task','u','Remove this backlog content','todo',1,1);
  const day={plans:[{id:'activity',title:'Preserve scheduled work',start:540,end:600,status:'pending',taskId:'task',priorityId:'priority'}],entries:[{id:'entry',title:'Past record',start:545,end:590,planId:'activity'}],priorities:[{id:'priority',text:'Today’s priority',done:false}],notes:{thoughts:'Preserve thoughts',ideas:'Idea',review:'Review'}};
  const goal={kind:'goal',title:'Preserve goal',startMonth:'2026-01',endMonth:'2026-12',note:'Note',parentId:null,taskIds:['task']};
  db.prepare('INSERT INTO days VALUES(?,?,?,?,?)').run('u','2026-10-13',JSON.stringify(day),3,1);
  db.prepare('INSERT INTO planning VALUES(?,?,?,?,?)').run('goal','u',JSON.stringify(goal),2,1);
  const result=retireTasks(db,2);assert.deepEqual(result,{removedTasks:1,updatedDays:1,updatedPlanning:1});
  const d=db.prepare('SELECT document,version FROM days').get(),p=db.prepare('SELECT document,version FROM planning').get();
  const expected=structuredClone(day);delete expected.plans[0].taskId;assert.deepEqual(JSON.parse(d.document),expected);assert.equal(d.version,4);
  const expectedGoal={...goal};delete expectedGoal.taskIds;assert.deepEqual(JSON.parse(p.document),expectedGoal);assert.equal(p.version,3);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='tasks'").get(),undefined);
  assert.deepEqual(retireTasks(db,3),{removedTasks:0,updatedDays:0,updatedPlanning:0});
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});
