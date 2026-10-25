import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createImageLoader } from '../server/ai/images.mjs';

test('memo images are shrunk to 2048px, keep PNG for screenshots and skip other files', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'anotar-ai-images-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(join(dataDir, 'blobs'));
  const blank = (width, height) => sharp({ create: { width, height, channels: 3, background: '#fff' } });
  await blank(4000, 1000).png().toFile(join(dataDir, 'blobs', 'big'));
  await blank(800, 600).withMetadata({ exif: { IFD0: { Copyright: 'gps-ish' } } }).jpeg().toFile(join(dataDir, 'blobs', 'photo'));
  const files = [
    { key: 'big', mime: 'image/png' },
    { key: 'photo', mime: 'image/jpeg' },
    { key: 'photo', mime: 'application/pdf' },
    { key: '../outside', mime: 'image/png' },
  ];
  const load = createImageLoader({ store: { getCapture: () => ({ files }) }, dataDir });
  const images = await load({ captureId: 'c' });
  assert.deepEqual(images.map((i) => i.name), ['image-1.png', 'image-2.jpg']);
  const [big, photo] = await Promise.all(images.map((i) => sharp(i.data).metadata()));
  assert.deepEqual([big.format, big.width, big.height], ['png', 2048, 512]);
  assert.deepEqual([photo.format, photo.width, photo.exif], ['jpeg', 800, undefined]);
  assert.deepEqual(await load({ pageId: 'p' }), []);
});
