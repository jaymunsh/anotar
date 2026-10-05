import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createBackup,restoreBackup,verifyBackup} from '../server/backups.mjs';
import {operation} from './fixtures/sync.mjs';
import {applySyncOperation} from '../server/sync/operations.mjs';
test('explicit restore rotates epoch, restart preserves identity, old operations cannot replay',async t=>{
 const root=await mkdtemp(join(tmpdir(),'leneu-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let store=openStore(join(root,'live'));const identity=store.syncSession(),pending=operation(store);applySyncOperation(store,pending);
 await createBackup(join(root,'live'),join(root,'backup'));store.close();store=openStore(join(root,'live'));assert.equal(store.syncSession().epoch,identity.epoch);store.close();
 await restoreBackup(join(root,'backup'),join(root,'restored'));await verifyBackup(join(root,'restored'));
 store=openStore(join(root,'restored'));t.after(()=>store.close());const restored=store.syncSession();assert.equal(restored.workspaceId,identity.workspaceId);assert.notEqual(restored.epoch,identity.epoch);
 assert.throws(()=>applySyncOperation(store,pending),e=>e.code==='epoch_mismatch');assert.equal(store.getCapture(pending.entityId).text,pending.payload.text);
});
