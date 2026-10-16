import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { documentBlueprints, buildDocumentBlueprint } from '../shared/documentBlueprints.ts';
import { cleanItinerary } from '../shared/itinerary.ts';
import { serializePageDocument } from '../server/pages.mjs';
import { handleDocumentBlueprintRoute } from '../server/documentBlueprints.mjs';

test('every blueprint builds supported editable blocks, independent fresh IDs, and useful instructions', () => {
  assert.deepEqual(
    documentBlueprints.map((item) => item.id),
    ['research', 'meeting', 'development'],
  );
  const ids = new Set();
  for (const blueprint of documentBlueprints) {
    assert.equal(blueprint.version, 1);
    assert.ok(blueprint.instructions.some((text) => text.includes('미확인')));
    for (let run = 0; run < 2; run++) {
      const payload = buildDocumentBlueprint(blueprint.id);
      assert.doesNotThrow(() => serializePageDocument(payload.document));
      for (const block of payload.document.blocks) {
        assert.ok(!ids.has(block.id));
        ids.add(block.id);
        assert.equal(block.children.length, 0);
        assert.ok(['paragraph', 'heading', 'itinerary', 'checkListItem'].includes(block.type));
        if (block.type === 'itinerary')
          assert.deepEqual(cleanItinerary(block.props.data).entries, []);
        else assert.ok(Array.isArray(block.content));
      }
    }
  }
  const first = buildDocumentBlueprint('research');
  first.document.blocks[0].content[0].text = 'changed';
  assert.equal(buildDocumentBlueprint('research').document.blocks[0].content[0].text, '핵심 질문');
});

test('travel days use calendar arithmetic across leap/month/year boundaries without made-up itinerary entries', () => {
  const headings = (startDate, days) =>
    buildDocumentBlueprint('travel', { startDate, days })
      .document.blocks.filter((block) => block.type === 'heading')
      .map((block) => block.content[0].text);
  assert.ok(headings('2028-02-28', 3).includes('3일차 · 2028-03-01'));
  for (const days of [1, 3, 14]) {
    const document = buildDocumentBlueprint('travel', { startDate: '2028-02-28', days }).document;
    assert.doesNotThrow(() => serializePageDocument(document));
    const plans = document.blocks.filter((block) => block.type === 'itinerary');
    assert.equal(plans.length, days);
    plans.forEach((plan, index) => {
      const data = cleanItinerary(plan.props.data);
      assert.ok(data.title.startsWith(`${index + 1}일차 · `));
      assert.deepEqual(data.entries, []);
      const at = document.blocks.indexOf(plan);
      assert.equal(document.blocks[at - 2].content[0].text, data.title);
    });
    assert.equal(
      document.blocks.filter(
        (block) => block.type === 'checkListItem' && block.props.checked === false,
      ).length,
      3,
    );
    for (const title of [
      '예약과 교통',
      '예산',
      '준비물 체크리스트',
      '비상 연락과 대안',
      '공유 전 확인',
    ])
      assert.ok(headings('2028-02-28', days).includes(title));
  }

  assert.ok(headings('2026-12-31', 2).includes('2일차 · 2027-01-01'));
  assert.equal(headings('2026-10-01', 14).filter((text) => text.includes('일차')).length, 14);
  assert.ok(headings(undefined, 1).includes('1일차 · 날짜 미정'));
  for (const startDate of ['2026-02-29', '2026-13-01', 'today', '9999-12-31'])
    assert.throws(() => buildDocumentBlueprint('travel', { startDate, days: 2 }));
  for (const days of [0, 15, 1.5, NaN, '3'])
    assert.throws(() => buildDocumentBlueprint('travel', { days }));
  assert.throws(() => buildDocumentBlueprint('unknown'));
  assert.throws(() => buildDocumentBlueprint('research', { title: 'x'.repeat(161) }));
  assert.equal(buildDocumentBlueprint('meeting', { title: '  주간 회의  ' }).title, '주간 회의');
});

test('private blueprint HTTP reads share registry and validation; writes rejected; public server unregistered', async () => {
  const server = createServer((request, response) => {
    if (
      !handleDocumentBlueprintRoute(request, response, new URL(request.url, 'http://localhost'))
    ) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const list = await fetch(base + '/api/document-blueprints');
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).items, documentBlueprints);
    const detail = await fetch(
      base + '/api/document-blueprints/travel?startDate=2028-02-28&days=3&title=Trip',
    );
    const body = await detail.json();
    assert.equal(body.item.id, 'travel');
    assert.equal(body.payload.title, 'Trip');
    assert.doesNotThrow(() => serializePageDocument(body.payload.document));
    assert.equal((await fetch(base + '/api/document-blueprints/travel?days=30')).status, 400);
    assert.equal((await fetch(base + '/api/document-blueprints/missing')).status, 404);
    assert.equal((await fetch(base + '/api/document-blueprints', { method: 'POST' })).status, 405);
    const source = await readFile(new URL('../server/public.mjs', import.meta.url), 'utf8');
    assert.ok(!source.includes('documentBlueprint'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
