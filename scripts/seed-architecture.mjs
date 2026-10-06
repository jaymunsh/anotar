import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.mjs';
import { serializePageDocument } from '../server/pages.mjs';
import { architecturePageId } from '../shared/architecturePage.ts';

export async function ensureArchitecturePage(store) {
  const existing = store.getPage(architecturePageId, { includeDeleted: true });
  if (existing) return existing; // Preserve edits and intentional deletion.
  const source = JSON.parse(await readFile(new URL('../docs/examples/anotar-architecture.page.json', import.meta.url), 'utf8'));
  if (source.id !== architecturePageId) throw Error('구조 문서 ID가 일치하지 않습니다.');
  serializePageDocument(source.document);
  return store.createPage({ syncId: architecturePageId, title: source.title, icon: source.icon, document: source.document });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('사용법: node scripts/seed-architecture.mjs <data-dir>');
  const store = openStore(resolve(process.argv[2]));
  try { const page = await ensureArchitecturePage(store); console.log(JSON.stringify({ id: page.id, version: page.version })); }
  finally { store.close(); }
}
