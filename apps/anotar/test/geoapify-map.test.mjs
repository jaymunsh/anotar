import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { renderSharedPage } from '../server/publicPage.mjs';
import { preparePageExport } from '../server/pageExport.mjs';

const maps = await import('../server/geoapifyMaps.mjs').catch(() => ({}));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=', 'base64');
const entry = (id, latitude, longitude, extra = {}) => ({ id, date: '2026-10-03', start: '10:00', title: id, place: id, latitude, longitude, ...extra });
const entries = [entry('one', 37.5796, 126.977), entry('two', 37.5786, 126.9809), entry('three', 37.5826, 126.9831)];
const plan = (items = entries) => ({ version: 1, timezone: 'Asia/Seoul', title: '서울 세 곳', entries: items });
async function fixture(t, fetchImpl = async () => new Response(png, { headers: { 'content-type': 'image/png' } }), options = {}) {
  assert.equal(typeof maps.createGeoapifyMapService, 'function', 'map image generation is implemented');
  const dir = await mkdtemp(join(tmpdir(), 'leneu-geo-map-'));
  const blobDir = join(dir, 'blobs');
  await mkdir(blobDir);
  const store = openStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  let page = store.createPage({ title: '지도 계획' });
  page = store.updatePage({ ...page, expectedVersion: page.version, document: { schemaVersion: 1, blocks: [
    { id: 'paragraph', type: 'paragraph', props: {}, content: [{ type: 'text', text: '원문을 보존', styles: {} }], children: [] },
    { id: 'plan', type: 'itinerary', props: { data: JSON.stringify(plan()) }, children: [] },
  ] } });
  const input = { pageId: page.id, blockId: 'plan', expectedVersion: page.version, operationId: randomUUID(), style: 'positron' };
  return { dir, blobDir, store, page, input, service: maps.createGeoapifyMapService({ store, blobDir, apiKey: 'fixture-key-private', fetchImpl, ...options }) };
}

test('static map payload fits real coordinates, numbers visits and draws arrows only for consecutive same-day visits', () => {
  assert.equal(typeof maps.geoapifyMapPayload, 'function');
  const payload = maps.geoapifyMapPayload(plan(), 'positron');
  assert.equal(payload.style, 'positron');
  assert.equal(payload.lang, 'ko');
  assert.equal(payload.markers[0].type, 'material', 'use the POST renderer marker shape verified in a real image');
  assert.equal(payload.markers[0].size, 'large', 'POST numeric marker sizes can silently omit markers');
  assert.equal(payload.markers[0].textsize, 'medium', 'POST markers use the provider text-size enum');
  assert.deepEqual(payload.markers.map((m) => [m.text, m.lat, m.lon]), [['1', 37.5796, 126.977], ['2', 37.5786, 126.9809], ['3', 37.5826, 126.9831]]);
  assert.equal(payload.geometries.filter((g) => g.type === 'polygon').length, 2);
  assert.equal(payload.geometries.filter((g) => g.type === 'polyline').length, 4);
  assert.equal(payload.attribution, 'default');
  const mercator = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
  // Geoapify's GL renderer uses a 512px world at zoom zero, before scaleFactor.
  for (const marker of payload.markers) {
    const pixelsPerDegree = 512 * 2 ** payload.zoom / 360;
    const x = payload.width / 2 + (marker.lon - payload.center.lon) * pixelsPerDegree;
    const y = payload.height / 2 - (mercator(marker.lat) - mercator(payload.center.lat)) * pixelsPerDegree;
    assert.ok(x >= 69 && x <= payload.width - 69, 'numbered pins fit with horizontal breathing room');
    assert.ok(y >= 69 && y <= payload.height - 69, 'numbered pins fit with vertical breathing room');
  }

  const gaps = maps.geoapifyMapPayload(plan([entries[0], { ...entries[1], latitude: undefined, longitude: undefined }, entries[2], entry('next-day', 37.58, 126.98, { date: '2026-10-04' })]), 'osm-liberty');
  assert.deepEqual(gaps.markers.map((m) => m.text), ['1', '3', '4']);
  assert.equal(gaps.geometries.length, 0);
  assert.throws(() => maps.geoapifyMapPayload(plan(), 'https://evil.test'), /스타일/);
  assert.throws(() => maps.geoapifyMapPayload(plan([entry('polar', 89, 126)]), 'positron'), /위도/);
});

test('the neighborhood style keeps wider context and readable regional labels without heavy building shadows', () => {
  const close = maps.geoapifyMapPayload(plan(), 'osm-liberty');
  const context = maps.geoapifyMapPayload(plan(), 'osm-bright-smooth');
  assert.ok(context.zoom < close.zoom, 'include surrounding neighborhoods instead of tightly cropping the three stops');
  const layers = new Map(context.styleCustomization.map((layer) => [layer.layer, layer]));
  assert.equal(layers.get('building-top').color, 'none');
  assert.equal(layers.get('place-other').size, 17);
  assert.equal(context.lang, 'ko');
  assert.deepEqual(context.markers.map((marker) => marker.text), ['1', '2', '3']);
  assert.equal(context.geometries.filter((geometry) => geometry.type === 'polygon').length, 2);
});

test('generation atomically replaces only the itinerary image and exposes stored bytes to shares and offline export', async (t) => {
  let outbound = 0;
  const f = await fixture(t, async (url, options) => {
    outbound++;
    assert.equal(new URL(url).origin, 'https://maps.geoapify.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).style, 'klokantech-basic');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  f.input.style = 'klokantech-basic';
  const result = await f.service.generate(f.input);
  const block = result.item.document.blocks[1];
  assert.equal(result.item.version, f.page.version + 1);
  assert.deepEqual(result.item.document.blocks[0], f.page.document.blocks[0]);
  assert.equal(block.props.data, f.page.document.blocks[1].props.data);
  assert.equal(block.props.imageSource, 'geoapify');
  const asset = f.store.getAsset(block.props.assetId);
  assert.equal(asset.mime, 'image/png');
  assert.deepEqual(await readFile(join(f.blobDir, asset.key)), png);
  const html = renderSharedPage(result.item, 'test-token', new Map([[asset.id, asset]]));
  assert.match(html, /Powered by/);
  assert.match(html, /https:\/\/www.geoapify.com\//);
  assert.match(html, /\/s\/test-token\/assets\//);
  assert.doesNotMatch(html, /fixture-key-private|maps.geoapify.com|maps.googleapis.com/);
  const exported = preparePageExport({ store: f.store, pageId: f.page.id, expectedVersion: result.item.version, dataDir: f.dir });
  const exportedImage = exported.find((file) => file.name.startsWith(`files/${asset.id}.`));
  assert.ok(exportedImage);
  assert.deepEqual(await readFile(exportedImage.path), png);
  assert.match(exported[0].data.toString(), /Powered by/);
  assert.equal(outbound, 1);
});

test('successful retries and concurrent identical requests reuse one image, even after later edits', async (t) => {
  let outbound = 0;
  const f = await fixture(t, async () => {
    outbound++;
    await new Promise((r) => setTimeout(r, 30));
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  const [first, concurrent] = await Promise.all([f.service.generate(f.input), f.service.generate(f.input)]);
  assert.equal(first.item.document.blocks[1].props.assetId, concurrent.item.document.blocks[1].props.assetId);
  f.store.updatePage({ ...first.item, expectedVersion: first.item.version, title: '나중 수정' });
  const restart = maps.createGeoapifyMapService({ store: f.store, blobDir: f.blobDir, apiKey: '', fetchImpl: () => { throw new Error('should not fetch'); } });
  assert.equal((await restart.generate(f.input)).replayed, true);
  assert.equal(outbound, 1);
  assert.equal((await readdir(f.blobDir)).length, 1);
  await assert.rejects(restart.generate({ ...f.input, style: 'osm-liberty' }), { name: 'PageConflictError' });
});

test('stale pages and no-key configuration make no outbound requests', async (t) => {
  let outbound = 0;
  const f = await fixture(t, async () => { outbound++; throw new Error(); });
  f.store.updatePage({ ...f.page, expectedVersion: f.page.version, title: '다른 창 수정' });
  await assert.rejects(f.service.generate(f.input), { name: 'PageConflictError' });
  const off = maps.createGeoapifyMapService({ store: f.store, blobDir: f.blobDir, apiKey: '', fetchImpl: () => { outbound++; } });
  await assert.rejects(off.generate({ ...f.input, expectedVersion: f.page.version + 1 }), /GEOAPIFY_API_KEY/);
  assert.equal(outbound, 0);
});

test('upstream errors are sanitized, bounded, and do not replace the existing page or leave files', async (t) => {
  const f = await fixture(t, async () => { throw new Error('https://maps.geoapify.com/?apiKey=fixture-key-private'); });
  await assert.rejects(f.service.generate(f.input), (error) => /연결/.test(error.message) && !error.message.includes('fixture-key-private'));
  const invalid = maps.createGeoapifyMapService({ store: f.store, blobDir: f.blobDir, apiKey: 'fixture-key-private', fetchImpl: async () => new Response('<html>bad</html>', { headers: { 'content-type': 'image/png' } }) });
  await assert.rejects(invalid.generate(f.input), /이미지/);
  const oversized = maps.createGeoapifyMapService({ store: f.store, blobDir: f.blobDir, apiKey: 'fixture-key-private', fetchImpl: async () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(30 * 1024 * 1024) } }) });
  await assert.rejects(oversized.generate(f.input), /이미지/);
  assert.equal(f.store.getPage(f.page.id).version, f.page.version);
  assert.deepEqual(await readdir(f.blobDir), []);
});

test('an edit during generation rejects the late result and cleans generated bytes', async (t) => {
  let f;
  f = await fixture(t, async () => {
    f.store.updatePage({ ...f.page, expectedVersion: f.page.version, title: '생성 중 수정' });
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  await assert.rejects(f.service.generate(f.input), { name: 'PageConflictError' });
  assert.equal(f.store.getPage(f.page.id).title, '생성 중 수정');
  assert.deepEqual(await readdir(f.blobDir), []);
});

test('daily request cap persists across service restarts and rejects excess requests before fetching', async (t) => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('quota', { status: 429 }); };
  const f = await fixture(t, fetchImpl, { dailyLimit: 1 });
  await assert.rejects(f.service.generate(f.input), /한도/);
  const restart = maps.createGeoapifyMapService({ store: f.store, blobDir: f.blobDir, apiKey: 'fixture-key-private', fetchImpl, dailyLimit: 1 });
  await assert.rejects(restart.generate(f.input), /오늘/);
  assert.equal(calls, 1);
});


test('reselecting another itinerary image retains attribution and stale-location notices', async (t) => {
  const { staticMapImageMetadata } = await import('../shared/staticMap.ts');
  assert.equal(typeof staticMapImageMetadata, 'function');
  const f = await fixture(t);
  const generated = await f.service.generate(f.input);
  const source = generated.item.document.blocks[1];
  const different = plan([entry('far-away', 35, 129)]);
  const metadata = staticMapImageMetadata(generated.item.document.blocks, source.props.assetId);
  assert.deepEqual(metadata, { imageSource: 'geoapify', imageInput: source.props.imageInput });
  assert.deepEqual(staticMapImageMetadata(generated.item.document.blocks, 'uploaded-photo'), { imageSource: '', imageInput: '' });
  const page = f.store.updatePage({ ...generated.item, expectedVersion: generated.item.version, document: { schemaVersion: 1, blocks: [
    ...generated.item.document.blocks,
    { ...source, id: 'second-plan', props: { ...source.props, data: JSON.stringify(different), ...metadata } },
  ] } });
  const asset = f.store.getAsset(source.props.assetId);
  const html = renderSharedPage(page, 'token', new Map([[asset.id, asset]]));
  assert.equal((html.match(/Powered by/g) || []).length, 2);
  assert.match(html, /지도에는 이전 방문 위치/);
});
