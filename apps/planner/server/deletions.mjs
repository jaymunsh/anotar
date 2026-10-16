import {readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync,existsSync} from 'node:fs';
import {join} from 'node:path';

export function deletionRecords(directory,now=Date.now()) {
  const file=join(directory,'deletions.json');
  if(!existsSync(file))return [];
  const records=JSON.parse(readFileSync(file,'utf8'));
  if(!Array.isArray(records)||records.some(r=>!r||!/^[-a-f0-9]{36}$/.test(r.id)||!Number.isFinite(r.deletedAt)))throw Error('Invalid deletion journal');
  return records.filter(r=>r.deletedAt>now-8*86400000);
}
export function recordDeletion(directory,id,now=Date.now()) {
  const file=join(directory,'deletions.json'),temporary=file+'.next';
  const records=deletionRecords(directory,now).filter(r=>r.id!==id);records.push({id,deletedAt:now});
  writeFileSync(temporary,JSON.stringify(records),{mode:0o600});
  const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,file);
}
export function purgeDeletions(directory,now=Date.now()) {
  if(!existsSync(join(directory,'deletions.json')))return;
  const file=join(directory,'deletions.json'),temporary=file+'.next';
  writeFileSync(temporary,JSON.stringify(deletionRecords(directory,now)),{mode:0o600});
  renameSync(temporary,file);
}
