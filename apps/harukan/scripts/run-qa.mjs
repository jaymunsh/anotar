// Runs every scripts/qa-*.mjs in turn (each starts its own throwaway server and DB) and prints ok/FAIL; a failure shows its output.
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
let failed=0;
for(const file of readdirSync('scripts').filter(f=>/^qa-.*\.mjs$/.test(f)).sort()){
  const run=spawnSync(process.execPath,['scripts/'+file],{encoding:'utf8'});
  if(run.status===0){console.log('ok   '+file);continue;}
  failed++;console.log('FAIL '+file+'\n'+(run.stdout+run.stderr).split('\n').filter(l=>!/^\s+at /.test(l)).slice(-25).join('\n'));
}
process.exit(failed?1:0);
