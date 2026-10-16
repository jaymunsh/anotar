import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';

const run = promisify(execFile);
const dir = await mkdtemp(join(process.cwd(), '.docker-share-qa-'));
const project = 'leneu-qa-' + randomUUID().slice(0, 8);
const override = join(dir, 'qa-compose.json');
let started = false;
async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
const ownerPort = await freePort(), sharePort = await freePort();
const ownerBase = `http://127.0.0.1:${ownerPort}`;
const shareBase = `http://127.0.0.1:${sharePort}`;
const env = {
  ...process.env,
  LENEU_IMAGE: process.env.DOCKER_QA_IMAGE || 'leneu-storage:migration-qa',
  LENEU_DATA_DIR: join(dir, 'live'), LENEU_BACKUP_DIR: join(dir, 'automatic'),
  LENEU_PRIVATE_PORT: String(ownerPort), LENEU_SHARE_PORT: String(sharePort),
  // This isolated legacy share/backup fixture exercises no private authentication.
  AUTH_MODE: 'disabled', AUTH_SECRET_KEY: '',
  PUBLIC_SHARE_ORIGIN: shareBase, AI_RUNNER_KIND: 'disabled',
  AI_RUNNER_URL: '', AI_RUNNER_TOKEN: '', OCR_RUNNER_URL: '', OCR_RUNNER_TOKEN: '',
  GOOGLE_MAPS_DEMO_KEY: '',
};
const args = ['compose', '--env-file', '/dev/null', '-p', project, '-f', resolve('compose.yaml'), '-f', override];
async function compose(...command) {
  return run('docker', [...args, ...command], { env, maxBuffer: 10 * 1024 * 1024 });
}
async function api(path, body, method = 'POST') {
  const response = await fetch(ownerBase + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.ok, true, `${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Service did not become healthy: ' + url);
}
try {
  await mkdir(join(dir, 'live', 'blobs'), { recursive: true });
  await mkdir(join(dir, 'automatic'));
  await writeFile(join(dir, 'live', 'blobs', 'qa-note'), 'attachment preserved');
  const store = openStore(join(dir, 'live'));
  let page, capture, task;
  try {
    capture = store.createCapture({ kind: 'file', text: 'private memo preserved', files: [{ key: 'qa-note', name: 'note.txt', mime: 'text/plain', size: 20 }] });
    task = store.createTask({ title: '준비 할 일 보존', dueDate: '2026-10-03' });
    page = store.createPage({ title: 'Docker 이전 검증' });
    page = store.updatePage({ id: page.id, title: page.title, expectedVersion: page.version, document: { schemaVersion: 1, blocks: [
      { id: 'qa-comment-target', type: 'paragraph', props: {}, content: [{ type: 'text', text: '친구와 함께 보는 일정', styles: {} }], children: [] },
      { id: 'qa-asset', type: 'asset', props: { assetId: capture.files[0].id, display: 'file' }, content: [], children: [] },
    ] } });
  } finally { store.close(); }
  await writeFile(override, JSON.stringify({ services: { storage: { volumes: [`${dir}:/migration`] } } }));
  const config = JSON.parse((await compose('config', '--format', 'json')).stdout);
  for (const service of Object.values(config.services)) for (const port of service.ports) assert.equal(port.host_ip, '127.0.0.1');
  assert.equal(config.services.share.read_only, true);
  assert.equal(config.services.share.volumes.find((v) => v.target === '/data').read_only, true);
  assert.equal(config.services.share.volumes.find((v) => v.target === '/run/leneu').read_only, true);
  assert.ok(!config.services.share.volumes.some((v) => ['/migration', '/backups'].includes(v.target)));
  assert.ok(!Object.keys(config.services.share.environment).some((key) => /^(AI_|OCR_|GOOGLE_|BACKUP_)/.test(key)));
  assert.equal(Object.keys(config.services.share.networks).includes('owner'), false);
  started = true;
  const buildArgs = process.env.DOCKER_QA_SKIP_BUILD === '1' ? [] : ['--build'];
  await compose('up', '-d', '--wait', '--wait-timeout', '180', ...buildArgs);
  assert.equal((await fetch(ownerBase + '/api/health')).status, 200);
  assert.deepEqual(await (await fetch(shareBase + '/health')).json(), { ok: true });
  const { token, item: link } = await api(`/api/pages/${page.id}/shares`, { expiresInDays: 1, commentsEnabled: true });
  const shared = await fetch(shareBase + '/s/' + token);
  assert.equal(shared.status, 200);
  assert.match(await shared.text(), /Docker 이전 검증/);
  const posted = await fetch(shareBase + '/s/' + token + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: shareBase }, body: JSON.stringify({ requestId: randomUUID(), action: 'create', blockId: 'qa-comment-target', name: '친구', text: '컨테이너에서도 댓글 저장을 확인해요.' }) });
  assert.equal(posted.status, 200, await posted.clone().text());
  const thread = (await posted.json()).items[0];
  assert.equal(thread.comments[0].name, '친구');
  const { items: seen } = await (await fetch(ownerBase + `/api/pages/${page.id}/shared-comments`)).json();
  assert.equal(seen[0].id, thread.id);
  const badOrigin = await fetch(shareBase + '/s/' + token + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://wrong.example' }, body: '{}' });
  assert.equal(badOrigin.status, 403);
  for (const path of ['/api/pages', '/api/shared-comments', '/api/tasks', '/api/backups', '/api/ai/status', '/api/ocr/status', `/api/pages/${page.id}/plan-connections`, '/capture/share', '/capture-worker.js', '/capture.webmanifest']) {
    assert.equal((await fetch(shareBase + path)).status, 404, path);
  }
  await assert.rejects(compose('exec', '-T', 'share', 'node', '-e', "require('node:fs').writeFileSync('/data/should-not-write','x')"));
  const snapshot = await compose('exec', '-T', 'storage', 'node', 'scripts/backup-data.mjs', 'create', '/data', '/migration/snapshot');
  assert.match(snapshot.stdout, /create 완료/);
  assert.match((await compose('exec', '-T', 'storage', 'node', 'scripts/backup-data.mjs', 'verify', '/migration/snapshot')).stdout, /verify 완료/);
  assert.match((await compose('exec', '-T', 'storage', 'node', 'scripts/backup-data.mjs', 'restore', '/migration/snapshot', '/migration/restored')).stdout, /restore 완료/);
  await assert.rejects(compose('exec', '-T', 'storage', 'node', 'scripts/backup-data.mjs', 'restore', '/migration/snapshot', '/migration/restored'));
  const restored = openStore(join(dir, 'restored'));
  try {
    assert.equal(restored.getPage(page.id).title, page.title);
    assert.equal(restored.getCapture(capture.id).text, capture.text);
    assert.equal(restored.getTask(task.id).title, task.title);
    assert.equal(restored.listSharedComments(page.id)[0].comments[0].text, thread.comments[0].text);
  } finally { restored.close(); }
  await compose('restart', 'storage');
  await waitFor(ownerBase + '/api/health');
  assert.equal((await waitFor(shareBase + '/s/' + token + '/comments')).status, 200);
  const replay = await fetch(shareBase + '/s/' + token + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: shareBase }, body: JSON.stringify({ requestId: randomUUID(), action: 'reply', threadId: thread.id, expectedVersion: thread.version, name: '친구', text: '재시작 후에도 답글이 저장돼요.' }) });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json()).items[0].comments.length, 2);
  assert.equal((await fetch(ownerBase + `/api/assets/${capture.files[0].id}`)).status, 200);
  const exported = await fetch(ownerBase + `/api/pages/${page.id}/export?version=${page.version}`);
  assert.equal(exported.status, 200);
  assert.ok((await exported.arrayBuffer()).byteLength > 100);
  // Run both production services against the newly restored directory, not just a host DB read.
  env.LENEU_DATA_DIR = join(dir, 'restored');
  await compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180');
  assert.equal((await fetch(ownerBase + `/api/pages/${page.id}`)).status, 200);
  assert.equal((await fetch(ownerBase + `/api/assets/${capture.files[0].id}`)).status, 200);
  const restoredComments = await (await fetch(shareBase + '/s/' + token + '/comments')).json();
  assert.equal(restoredComments.items[0].comments.length, 1, 'Restore reflects the snapshot point before the later reply');
  const restoredReply = await fetch(shareBase + '/s/' + token + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: shareBase }, body: JSON.stringify({ requestId: randomUUID(), action: 'reply', threadId: thread.id, expectedVersion: thread.version, name: '친구', text: '복원된 새 경로에서도 답글을 남겨요.' }) });
  assert.equal(restoredReply.status, 200, await restoredReply.clone().text());
  await api(`/api/pages/${page.id}/shares/${link.id}`, undefined, 'DELETE');
  assert.equal((await fetch(shareBase + '/s/' + token)).status, 404);
  assert.equal((await fetch(shareBase + '/s/' + token + '/comments')).status, 404);
  const ids = (await compose('ps', '-q')).stdout.trim().split('\n').filter(Boolean);
  const stats = JSON.parse((await run('docker', ['inspect', ids[0]], { maxBuffer: 1024 * 1024 })).stdout)[0];
  assert.equal(stats.HostConfig.RestartPolicy.Name, 'unless-stopped');
  console.log('Docker migration QA passed: temporary Compose project, read-only public boundary, socket comments, origin/revoke checks, restart durability, production backup CLI, verified new-directory restore and production service boot, attachment/export. Host Docker only; not N100/reboot/network deployment.');
} finally {
  if (started) await compose('down', '--volumes', '--remove-orphans').catch((error) => console.error('QA project cleanup failed:', error.message));
  await rm(dir, { recursive: true, force: true });
}
