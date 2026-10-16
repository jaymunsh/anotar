import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDeploymentConfig, checkDeploymentEndpoints } from '../scripts/migration-check.mjs';

const config = () => ({ services: {
  storage: { ports: [{ host_ip: '127.0.0.1', target: 8787 }], environment: { PUBLIC_SHARE_ORIGIN: 'https://share.example.com' }, networks: { owner: {} }, volumes: [{ target: '/data' }, { target: '/backups' }] },
  share: { ports: [{ host_ip: '127.0.0.1', target: 8790 }], environment: { PUBLIC_SHARE_ORIGIN: 'https://share.example.com' }, networks: { public: {} }, read_only: true, volumes: [{ target: '/data', read_only: true }, { target: '/run/leneu', read_only: true }] }
} });
test('deployment config refuses accidental personal/public boundary broadening', () => {
  assert.equal(inspectDeploymentConfig(config()).ok, true);
  const variants = [
    (c) => { c.services.storage.ports[0].host_ip = '0.0.0.0'; },
    (c) => { c.services.share.volumes[0].read_only = false; },
    (c) => { c.services.share.environment.AI_RUNNER_TOKEN = 'must-not-be-public'; },
    (c) => { c.services.share.networks.owner = {}; },
    (c) => { c.services.share.volumes.push({ target: '/backups', read_only: true }); },
    (c) => { c.services.share.environment.PUBLIC_SHARE_ORIGIN = 'https://different.example.com'; },
  ];
  for (const change of variants) { const value = config(); change(value); assert.equal(inspectDeploymentConfig(value).ok, false); }
});
test('endpoint report detects missing API and public exposure without retaining private data', async () => {
  const seen = [];
  const fetcher = async (url) => {
    seen.push(url.pathname);
    return new Response(url.origin.includes('private') ? JSON.stringify({ ok: true, items: [{ text: 'secret memo' }] }) : JSON.stringify({ ok: true }), { status: url.origin.includes('private') || url.pathname === '/health' ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  };
  const good = await checkDeploymentEndpoints({ privateBase: 'https://private.example.com', publicBase: 'https://share.example.com', fetcher });
  assert.equal(good.ok, true);
  assert.ok(!JSON.stringify(good).includes('secret memo'));
  assert.ok(seen.includes('/api/backups'));
  const bad = await checkDeploymentEndpoints({ privateBase: 'https://private.example.com', publicBase: 'https://share.example.com', fetcher: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) });
  assert.equal(bad.ok, false);
  assert.ok(bad.checks.some((c) => !c.ok && c.name.includes('공개')));
});
