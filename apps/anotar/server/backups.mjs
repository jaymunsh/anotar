import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { rotateSyncEpochAfterRestore } from './sync/store.mjs';
import { shareLinkKeyFile } from './shareTokens.mjs';

const HASH = /^[a-f0-9]{64}$/;
// Uploads use bare UUIDs; generated map images also keep a file extension.
// Dot-separated filename segments allow both without accepting path components.
const STORAGE_KEY = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

function hasShareLinkTokens(path) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    const columns=db.prepare('PRAGMA table_info(page_shares)').all();
    return columns.some(column=>column.name==='token_cipher') && Boolean(db.prepare('SELECT 1 FROM page_shares WHERE token_cipher IS NOT NULL LIMIT 1').get());
  } finally {db.close();}
}

async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('일반 파일만 백업할 수 있습니다.');
  return info;
}

function safeKey(value) {
  if (typeof value !== 'string' || value.length > 255 || !STORAGE_KEY.test(value))
    throw new Error('안전하지 않은 첨부 저장 키입니다.');
  return value;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function inspectDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok')
      throw new Error('백업 DB 무결성 검사에 실패했습니다.');
    const files = new Map();
    for (const row of db.prepare('SELECT storage_key, size FROM assets').all()) {
      const key = safeKey(row.storage_key);
      if (!Number.isSafeInteger(row.size) || row.size < 0)
        throw new Error('첨부 크기가 올바르지 않습니다.');
      if (files.has(key) && files.get(key) !== row.size)
        throw new Error('같은 저장 키에 다른 크기가 기록되어 있습니다.');
      files.set(key, row.size);
    }
    return [...files].sort(([a], [b]) => a.localeCompare(b));
  } finally {
    db.close();
  }
}

async function stageDirectory(finalPath) {
  const path = resolve(finalPath);
  await realpath(dirname(path));
  if (!(await absent(path))) throw new Error('대상 디렉터리가 이미 있습니다.');
  const temporary = `${path}.partial-${randomUUID()}`;
  await mkdir(temporary, { mode: 0o700 });
  return { path, temporary };
}

export async function createBackup(dataDir, backupDir) {
  const data = await realpath(resolve(dataDir));
  const destination = resolve(backupDir);
  const parent = await realpath(dirname(destination));
  const realDestination = join(parent, destination.split(sep).at(-1));
  if (realDestination === data || realDestination.startsWith(data + sep))
    throw new Error('백업 대상은 원본 데이터 디렉터리 밖에 있어야 합니다.');
  await regularFile(join(data, 'storage.sqlite'));
  const { path, temporary } = await stageDirectory(destination);
  try {
    await mkdir(join(temporary, 'blobs'));
    const db = new DatabaseSync(join(data, 'storage.sqlite'), { readOnly: true });
    try {
      await backup(db, join(temporary, 'storage.sqlite'));
    } finally {
      db.close();
    }
    const rows = inspectDatabase(join(temporary, 'storage.sqlite'));
    const files = [];
    for (const [key, size] of rows) {
      const source = join(data, 'blobs', key);
      const info = await regularFile(source);
      if (info.size !== size) throw new Error(`첨부 크기가 DB와 다릅니다: ${key}`);
      const target = join(temporary, 'blobs', key);
      await copyFile(source, target);
      const copied = await regularFile(target);
      if (copied.size !== size) throw new Error(`첨부 복사 크기가 다릅니다: ${key}`);
      files.push({ key, size, sha256: await sha256(target) });
    }
    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      database: { sha256: await sha256(join(temporary, 'storage.sqlite')) },
      files,
    };
    if (hasShareLinkTokens(join(temporary,'storage.sqlite'))) {
      const source=join(data,shareLinkKeyFile), target=join(temporary,shareLinkKeyFile);
      if ((await regularFile(source)).size!==32) throw Error('공유 링크 키 형식이 올바르지 않습니다.');
      await copyFile(source,target);
      await chmod(target,0o600);
      manifest.shareLinkKey={sha256:await sha256(target)};
    }
    await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      mode: 0o600,
    });
    await verifyBackup(temporary);
    if (!(await absent(path))) throw new Error('대상 디렉터리가 이미 있습니다.');
    await rename(temporary, path);
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBackup(backupDir) {
  const directory = resolve(backupDir);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (
    manifest?.schemaVersion !== 1 ||
    typeof manifest.createdAt !== 'string' ||
    !HASH.test(manifest.database?.sha256) ||
    !Array.isArray(manifest.files)
  )
    throw new Error('백업 목록 형식이 올바르지 않습니다.');
  const dbPath = join(directory, 'storage.sqlite');
  await regularFile(dbPath);
  if ((await sha256(dbPath)) !== manifest.database.sha256)
    throw new Error('백업 DB 체크섬이 다릅니다.');
  if (hasShareLinkTokens(dbPath) && !manifest.shareLinkKey) throw Error('백업에 공유 링크 키가 없습니다.');
  if (manifest.shareLinkKey) {
    const keyPath=join(directory,shareLinkKeyFile);
    if (!HASH.test(manifest.shareLinkKey.sha256) || (await regularFile(keyPath)).size!==32 || await sha256(keyPath)!==manifest.shareLinkKey.sha256)
      throw Error('백업 공유 링크 키 검증에 실패했습니다.');
  }
  const rows = inspectDatabase(dbPath);
  const listed = new Map();
  for (const file of manifest.files) {
    const key = safeKey(file?.key);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !HASH.test(file.sha256))
      throw new Error('첨부 백업 목록이 올바르지 않습니다.');
    if (listed.has(key)) throw new Error('첨부 백업 목록에 중복 키가 있습니다.');
    listed.set(key, file);
  }
  if (listed.size !== rows.length) throw new Error('DB와 첨부 백업 목록이 다릅니다.');
  const actualNames = await readdir(join(directory, 'blobs'));
  if (actualNames.length !== rows.length) throw new Error('백업의 첨부 파일 수가 목록과 다릅니다.');
  for (const [key, size] of rows) {
    const file = listed.get(key);
    if (!file || file.size !== size) throw new Error(`첨부 목록이 DB와 다릅니다: ${key}`);
    const path = join(directory, 'blobs', key);
    const info = await regularFile(path);
    if (info.size !== size || (await sha256(path)) !== file.sha256)
      throw new Error(`첨부 백업 검증에 실패했습니다: ${key}`);
  }
  return manifest;
}

export async function restoreBackup(backupDir, targetDataDir) {
  const backupPath = await realpath(resolve(backupDir));
  const target = resolve(targetDataDir);
  const targetParent = await realpath(dirname(target));
  const realTarget = join(targetParent, target.split(sep).at(-1));
  if (realTarget === backupPath || realTarget.startsWith(backupPath + sep))
    throw new Error('복원 대상은 백업 디렉터리 밖에 있어야 합니다.');
  const manifest = await verifyBackup(backupPath);
  const { path, temporary } = await stageDirectory(target);
  try {
    await mkdir(join(temporary, 'blobs'));
    await copyFile(join(backupPath, 'storage.sqlite'), join(temporary, 'storage.sqlite'));
    await copyFile(join(backupPath, 'manifest.json'), join(temporary, 'manifest.json'));
    if (manifest.shareLinkKey) {
      await copyFile(join(backupPath,shareLinkKeyFile),join(temporary,shareLinkKeyFile));
      await chmod(join(temporary,shareLinkKeyFile),0o600);
    }
    for (const { key } of manifest.files)
      await copyFile(join(backupPath, 'blobs', key), join(temporary, 'blobs', key));
    await verifyBackup(temporary);
    const restoredDb=new DatabaseSync(join(temporary,'storage.sqlite'));
    try {rotateSyncEpochAfterRestore(restoredDb);}finally{restoredDb.close();}
    const restoredManifest={...manifest,restoredAt:new Date().toISOString(),restoredFromDatabaseHash:manifest.database.sha256,database:{sha256:await sha256(join(temporary,'storage.sqlite'))}};
    await writeFile(join(temporary,'manifest.json'),JSON.stringify(restoredManifest,null,2),{mode:0o600});
    await verifyBackup(temporary);
    if (!(await absent(path))) throw new Error('복원 대상이 이미 있습니다.');
    await rename(temporary, path);
    return restoredManifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
