import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import config from '../vite.config.ts';
import { offlineApp } from '../scripts/fixtures/offline-app.mjs';

test('development proxy accepts its own browser writes and rejects foreign origins', async () => {
  const app = await offlineApp();
  const proxy = config.server.proxy['/api'];
  const vite = await createServer({
    ...config,
    configFile: false,
    server: {
      ...config.server,
      port: 0,
      proxy: { '/api': typeof proxy === 'string' ? app.base : { ...proxy, target: app.base } },
    },
  });
  try {
    await vite.listen();
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const write = (origin) => fetch(base + '/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ title: '개발 서버 저장 확인' }),
    });
    const local = await write(base);
    assert.equal(local.status, 201, 'browser writes through Vite must retain their same-origin identity');
    assert.equal((await local.json()).item.title, '개발 서버 저장 확인');
    const foreign = await write('https://untrusted.example');
    assert.equal(foreign.status, 403, 'the proxy must preserve the private API boundary');
  } finally {
    await vite.close();
    await app.close();
  }
});
