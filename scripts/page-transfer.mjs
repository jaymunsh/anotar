import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.mjs';
import { cleanPageTitle, cleanPageIcon, cleanPageParentId, serializePageDocument } from '../server/pages.mjs';
import { referencedAssetIds } from '../server/publicPage.mjs';

function payload(page) {
  return { id: page.id, title: page.title, icon: page.icon, parentId: page.parentId ?? null, document: page.document };
}
const fingerprint = page => createHash('sha256').update(JSON.stringify(payload(page))).digest('hex');
function readPage(directory, id) {
  const db = new DatabaseSync(join(resolve(directory), 'storage.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT id,title,icon,parent_id AS parentId,document,version,deleted_at FROM pages WHERE id=?').get(id);
    if (row?.deleted_at) throw Error('휴지통의 페이지는 이관하지 않습니다.');
    return row ? { ...row, document: JSON.parse(row.document) } : null;
  } finally { db.close(); }
}

export function createPageChange(baselineDirectory, localDirectory, id) {
  const base = readPage(baselineDirectory, id), page = readPage(localDirectory, id);
  if (!page) throw Error('로컬 페이지를 찾을 수 없습니다.');
  if (base && base.parentId !== page.parentId)
    throw Error('본문 이관과 페이지 계층 이동은 따로 처리해 주세요.');
  serializePageDocument(page.document);
  return { schemaVersion: 1, page: payload(page), base: base ? { version: base.version, fingerprint: fingerprint(base) } : null };
}

export function applyPageChange(store, change, { dryRun = false } = {}) {
  if (change?.schemaVersion !== 1 || !change.page ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(change.page.id))
    throw Error('페이지 이관 형식이 올바르지 않습니다.');
  const page = {
    id: change.page.id, title: cleanPageTitle(change.page.title), icon: cleanPageIcon(change.page.icon),
    parentId: cleanPageParentId(change.page.parentId), document: JSON.parse(serializePageDocument(change.page.document)),
  };
  if (change.base !== null && (!Number.isSafeInteger(change.base?.version) || change.base.version < 1 || !/^[a-f0-9]{64}$/.test(change.base?.fingerprint)))
    throw Error('서버 기준 버전이 올바르지 않습니다.');
  const current = store.getPage(page.id);
  if (!current && store.getPage(page.id, { includeDeleted: true }))
    throw Error('서버 휴지통의 페이지를 자동 복원하지 않습니다.');
  for (const id of referencedAssetIds(page.document))
    if (!store.getAsset(id)) throw Error('서버에 없는 새 첨부입니다. 첨부를 먼저 올린 뒤 이관해 주세요.');
  if (page.parentId && !store.getPage(page.parentId)) throw Error('서버에 상위 페이지가 없습니다.');
  store.validatePageReferences(page.document, current?.document ?? null, { newPageId: current ? null : page.id });
  if (current && fingerprint(current) === fingerprint(page)) return current;
  if (change.base === null) {
    if (current) throw Error('서버에 같은 ID의 다른 페이지가 있어 충돌했습니다.');
    return dryRun ? page : store.createPage({ ...page, syncId: page.id });
  }
  if (!current || current.version !== change.base.version || fingerprint(current) !== change.base.fingerprint)
    throw Error('서버에서 먼저 수정한 페이지입니다. 충돌 내용을 확인해 주세요.');
  if (page.parentId !== current.parentId) throw Error('본문 이관과 페이지 계층 이동은 따로 처리해 주세요.');
  return dryRun ? page : store.updatePage({ ...page, expectedVersion: change.base.version });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'export' && args.length === 4) {
    const change = createPageChange(...args.slice(0, 3));
    await writeFile(resolve(args[3]), JSON.stringify(change), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ id: change.page.id, baseVersion: change.base?.version ?? null }));
  } else if (['import', 'check'].includes(command) && args.length === 2) {
    const [directory, input] = args;
    if (!(await stat(join(resolve(directory), 'storage.sqlite'))).isFile()) throw Error('대상 DB를 확인해 주세요.');
    const bytes = input === '-' ? await readFile('/dev/stdin') : await readFile(resolve(input));
    if (bytes.length > 2 * 1024 * 1024) throw Error('이관 파일이 너무 큽니다.');
    const store = openStore(resolve(directory));
    try {
      const page = applyPageChange(store, JSON.parse(bytes.toString('utf8')), { dryRun: command === 'check' });
      console.log(JSON.stringify({ id: page.id, version: page.version ?? null, checkedOnly: command === 'check' }));
    } finally { store.close(); }
  } else throw Error('사용법: export <baseline-dir> <local-data-dir> <page-id> <new-file> | check/import <target-data-dir> <file|->');
}
