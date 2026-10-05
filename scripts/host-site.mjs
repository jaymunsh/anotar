import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostingStore } from '../server/hosting/store.mjs';
const args = process.argv.slice(2),
  command = args.shift();
const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--publish') options.publish = true;
  else if (args[i].startsWith('--')) options[args[i].slice(2)] = args[++i];
  else if (!options.source) options.source = args[i];
  else throw new Error('입력 값을 확인해 주세요.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const store = createHostingStore(
  resolve(options.dir || process.env.HOSTED_SITES_DIR || root + 'hosted-sites'),
);
try {
  if (command === 'list') console.log(JSON.stringify(store.list(), null, 2));
  else if (command === 'import' && options.source && options.name) {
    const item = await store.importDirectory({
      source: options.source,
      slug: options.slug,
      name: options.name,
      entry: options.entry || 'index.html',
      enabled: options.publish === true,
    });
    console.log(JSON.stringify(item, null, 2));
  } else {
    console.error(
      '사용법: npm run sites:import -- <폴더> --name "수학" [--slug mathematics] [--entry index.html] [--publish] [--dir 저장폴더]\n목록: node scripts/host-site.mjs list',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
