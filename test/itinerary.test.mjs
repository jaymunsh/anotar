import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openStore } from '../server/store.mjs';
import { PageValidationError, serializePageDocument } from '../server/pages.mjs';

const exec = promisify(execFile);

test('itinerary sample seeds once with timetable and valid map blocks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-itinerary-'));
  try {
    for (let index = 0; index < 2; index++)
      await exec(process.execPath, ['scripts/seed-itinerary-sample.mjs'], {
        env: { ...process.env, DATA_DIR: dir },
      });
    const store = openStore(dir);
    const pages = store.listPages();
    assert.equal(pages.length, 1);
    const page = store.getPage(pages[0].id);
    assert.equal(page.document.blocks.filter((block) => block.type === 'table').length, 2);
    assert.equal(page.document.blocks.filter((block) => block.type === 'map').length, 2);
    const invalid = structuredClone(page.document);
    invalid.blocks.find((block) => block.type === 'map').props.latitude = 900;
    assert.throws(() => serializePageDocument(invalid), PageValidationError);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
