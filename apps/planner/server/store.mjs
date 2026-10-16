import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(directory) {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const filename = join(directory, 'planner.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL, recovery_hash TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Seoul', created_at INTEGER NOT NULL,
      terms_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS days (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, document TEXT NOT NULL, version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,date)
    );
    CREATE TABLE IF NOT EXISTS planning (
      id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,id)
    );
    CREATE TABLE IF NOT EXISTS auth_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );`);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn(); db.exec('COMMIT'); return result; }
  catch(error) {db.exec('ROLLBACK'); throw error;}
}

export function validDate(value) {
  if(typeof value!=='string'||!/^20\d\d-\d{2}-\d{2}$/.test(value)) return false;
  const d=new Date(value+'T12:00:00Z');
  return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;
}
export const emptyDay = () => ({plans:[],entries:[],notes:{thoughts:'',ideas:'',review:''}});
export function validateDay(raw, db, userId) {
  if(!raw||!Array.isArray(raw.plans)||!Array.isArray(raw.entries)||raw.plans.length>100||raw.entries.length>100) throw Error('하루에 기록할 수 있는 항목은 각 100개까지예요.');
  let priorities;
  if(raw.priorities!==undefined){if(!Array.isArray(raw.priorities)||raw.priorities.length>20)throw Error('오늘 할 일은 20개까지 작성할 수 있어요.');const ids=new Set();priorities=raw.priorities.map(p=>{if(!p||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)||ids.has(p.id)||typeof p.text!=='string'||p.text.length>300||typeof p.done!=='boolean')throw Error('오늘 할 일의 내용을 확인해 주세요.');ids.add(p.id);return {id:p.id,text:p.text,done:p.done};});}
  const identifiers=new Set();
  function item(raw,actual=false) {
    if(!raw||typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id)||identifiers.has(raw.id)) throw Error('항목 식별자가 올바르지 않아요.');
    identifiers.add(raw.id);
    if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>200||!Number.isInteger(raw.start)||!Number.isInteger(raw.end)||raw.start<0||raw.end>1440||raw.end<=raw.start) throw Error('제목과 시작·종료 시간을 확인해 주세요.');
    const value={id:raw.id,title:raw.title.trim(),start:raw.start,end:raw.end};
    if(!actual) {
      if(!['pending','done','partial','deferred','cancelled','missed'].includes(raw.status)) throw Error('일정 상태를 확인해 주세요.');
      value.status=raw.status;
      if(raw.planningId!==undefined&&raw.planningId!==null){
        if(typeof raw.planningId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(raw.planningId))throw Error('연결할 계획을 확인해 주세요.');
        // Only the owner's existing planning item is kept; a deleted or foreign id is dropped so it never blocks saving the day.
        if(db.prepare('SELECT 1 FROM planning WHERE user_id=? AND id=?').get(userId,raw.planningId))value.planningId=raw.planningId;
      }
      if(raw.priorityId){if(typeof raw.priorityId!=='string'||!priorities?.some(p=>p.id===raw.priorityId))throw Error('연결할 오늘 할 일을 찾을 수 없어요.');value.priorityId=raw.priorityId;}

    } else if(raw.planId) {
      if(typeof raw.planId!=='string'||!rawDayPlanIds.has(raw.planId)) throw Error('연결할 계획을 찾을 수 없어요.');
      value.planId=raw.planId;
    }
    return value;
  }
  const rawDayPlanIds=new Set(raw.plans.map(p=>p?.id));
  const plans=raw.plans.map(p=>item(p));
  const entries=raw.entries.map(e=>item(e,true));
  const notes={};
  for(const key of ['thoughts','ideas','review']) {
    const value=raw.notes?.[key]??'';
    if(typeof value!=='string'||value.length>20000) throw Error('메모는 각 20,000자까지 작성할 수 있어요.');
    notes[key]=value;
  }
  return {plans,entries,notes,...(priorities?{priorities}:{})};
}
