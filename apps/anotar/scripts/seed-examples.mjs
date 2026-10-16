// Seed a fresh workspace with the example guide pages in examples/seed/.
//   node scripts/seed-examples.mjs [DATA_DIR]          (default: $DATA_DIR or ./data)
// Additive only: a page whose id already exists is skipped, never overwritten.
// Page ids are kept so the guide's link to the architecture page keeps working.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openStore } from '../server/store.mjs';

const dataDir = resolve(process.argv[2] || process.env.DATA_DIR || 'data');
const folder = new URL('../examples/seed/', import.meta.url);
const parentId = '5e2d9b77-0000-4000-8000-a00000000001';
// architecture first: the guide links to it.
const order = ['architecture', 'markdown-guide', 'mcp-proposal'];

const files = (await readdir(folder)).filter((f) => f.endsWith('.page.json'));
files.sort((a, b) => order.indexOf(a.replace('.page.json', '')) - order.indexOf(b.replace('.page.json', '')));
const store = openStore(dataDir);
const result = { dataDir, created: [], skipped: [] };
try {
  if (!store.getPage(parentId)) {
    store.createPage({ syncId: parentId, title: 'Anotar 안내', icon: '📚' });
    result.created.push('Anotar 안내');
  }
  for (const file of files) {
    const page = JSON.parse(await readFile(new URL(file, folder), 'utf8'));
    if (store.getPage(page.id)) {
      result.skipped.push(page.title);
      continue;
    }
    store.createPage({ syncId: page.id, title: page.title, icon: page.icon, parentId, document: page.document });
    result.created.push(page.title);
  }
} finally {
  store.close();
}
console.log(JSON.stringify(result, null, 2));
