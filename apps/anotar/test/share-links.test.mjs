import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { createBackup, restoreBackup, verifyBackup } from '../server/backups.mjs';

test('a share link can be retrieved after restart without storing its raw token in SQLite', async t => {
  const dir=await mkdtemp(join(tmpdir(),'leneu-share-link-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let store=openStore(dir);
  const page=store.createPage({title:'공유 문서'}), other=store.createPage({title:'다른 문서'});
  const created=store.createPageShare(page.id,{expiresInDays:null});
  assert.equal(store.listPageShares(page.id)[0].linkAvailable,true);
  assert.equal(store.listPageShares(page.id)[0].token,undefined);
  assert.equal(store.getPageShareToken(page.id,created.item.id),created.token);
  assert.equal(store.getPageShareToken(other.id,created.item.id),null);
  store.close(); store=openStore(dir);
  try {
    assert.equal(store.getPageShareToken(page.id,created.item.id),created.token);
    const db=new DatabaseSync(join(dir,'storage.sqlite'));
    const row=db.prepare('SELECT * FROM page_shares WHERE id=?').get(created.item.id);
    assert.ok(row.token_cipher); assert.ok(!JSON.stringify(row).includes(created.token));
    assert.equal((await stat(join(dir,'share-link.key'))).mode & 0o777,0o600);
    db.prepare('UPDATE page_shares SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z',created.item.id);
    assert.equal(store.getPageShareToken(page.id,created.item.id),null);
    db.close();
    const second=store.createPageShare(page.id,{});
    store.revokePageShare(page.id,second.item.id);
    assert.equal(store.getPageShareToken(page.id,second.item.id),null);
  } finally {store.close();}
});

test('legacy hash-only links remain valid and are explicitly unavailable for retrieval', async t => {
  const dir=await mkdtemp(join(tmpdir(),'leneu-share-legacy-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=openStore(dir);
  try {
    const page=store.createPage({title:'기존 문서'}), created=store.createPageShare(page.id,{});
    const db=new DatabaseSync(join(dir,'storage.sqlite'));
    db.prepare('UPDATE page_shares SET token_cipher=NULL WHERE id=?').run(created.item.id);
    db.close();
    assert.equal(store.listPageShares(page.id)[0].linkAvailable,false);
    assert.equal(store.getPageShareToken(page.id,created.item.id),null);
    assert.equal(store.listPageShares(page.id)[0].revokedAt,null);
  } finally {store.close();}
});

test('backup and restore preserve retrievable links, and a damaged vault key is rejected', async t => {
  const root=await mkdtemp(join(tmpdir(),'leneu-share-backup-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'data'), store=openStore(dir);
  const page=store.createPage({title:'복원 문서'}), created=store.createPageShare(page.id,{});
  store.close();
  const manifest=await createBackup(dir,join(root,'backup'));
  assert.ok(manifest.shareLinkKey?.sha256);
  await restoreBackup(join(root,'backup'),join(root,'restored'));
  const restored=openStore(join(root,'restored'));
  try {assert.equal(restored.getPageShareToken(page.id,created.item.id),created.token);} finally {restored.close();}
  const key=await readFile(join(root,'backup','share-link.key'));
  await writeFile(join(root,'backup','share-link.key'),Buffer.alloc(key.length));
  await assert.rejects(verifyBackup(join(root,'backup')),/공유 링크 키/);
});

test('encrypted links reject tampering and a missing key without replacing it or revoking links', async t => {
  const dir=await mkdtemp(join(tmpdir(),'leneu-share-key-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=openStore(dir);
  try {
    const page=store.createPage({title:'검증 문서'}), created=store.createPageShare(page.id,{});
    const db=new DatabaseSync(join(dir,'storage.sqlite'));
    const cipher=db.prepare('SELECT token_cipher FROM page_shares WHERE id=?').get(created.item.id).token_cipher;
    const tampered=cipher.split('.'); tampered[2]=(tampered[2][0]==='A'?'B':'A')+tampered[2].slice(1);
    db.prepare('UPDATE page_shares SET token_cipher=? WHERE id=?').run(tampered.join('.'),created.item.id);
    assert.throws(()=>store.getPageShareToken(page.id,created.item.id),/공유 링크를 읽지 못/);
    db.prepare('UPDATE page_shares SET token_cipher=? WHERE id=?').run(cipher,created.item.id);
    db.close();
    await rm(join(dir,'share-link.key'));
    assert.throws(()=>store.getPageShareToken(page.id,created.item.id),/공유 링크를 읽지 못/);
    assert.throws(()=>store.createPageShare(page.id,{}),/기존 키를 복원/);
    assert.equal(store.listPageShares(page.id)[0].revokedAt,null);
    await assert.rejects(readFile(join(dir,'share-link.key')), {code:'ENOENT'});
  } finally {store.close();}
});
