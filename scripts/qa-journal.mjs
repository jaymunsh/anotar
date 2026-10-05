import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { journalId, normalizeJournalDay } from '../shared/journal.mjs';
import { selectAppTheme } from './qa-compact-pages.mjs';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';
const evidence = '.omo/evidence/journal-sync';
await mkdir(evidence, { recursive: true });
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const addDays = (date, count) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};
const empty = () => ({
  priorities: [{ text: '이전 핵심', done: false }],
  brain: '이전 생각',
  idea: '이전 아이디어',
  feedback: '기존 회고',
  plan: [],
  actual: [
    { id: 'legacy-actual', start: 0, end: 10, title: '이전 실제 기록', kind: 'life', note: '' },
  ],
});
const legacy = JSON.stringify({ theme: 'light', days: { [today]: empty() } });
const bundled = await build({
  stdin: {
    contents:
      "import * as runtime from './src/sync/runtime.ts';import * as repo from './src/sync/repository.ts';import * as storage from './src/journal/storage.ts';import * as exporter from './src/offline/exportPending.ts';import * as recovery from './src/offline/recovery.ts';import {workspaceRepository} from './src/sync/workspaceRepository.ts';window.fixture={...runtime,...repo,...storage,...exporter,...recovery,workspaceRepository};",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const app = await offlineApp();
const checks = [],
  errors = [];
const wait = async (fn) => {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('상태 확인 시간 초과');
};
async function hooks(page) {
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.evaluate(() => fixture.getWorkspaceRuntime());
}
async function entity(page, date = today) {
  return page.evaluate(async (date) => {
    const { workspaceId } = await fixture.getWorkspaceRuntime();
    const rows = await fixture.listRecords('entities', workspaceId, 10000);
    return rows.find((e) => e.kind === 'journal' && e.current?.date === date);
  }, date);
}
async function serverDay(date = today) {
  const session = await (await fetch(app.base + '/api/sync/session')).json();
  return (
    await (
      await fetch(app.base + '/api/sync/entities/journal/' + journalId(session.workspaceId, date))
    ).json()
  ).item;
}
async function chooseDate(page, date) {
  await page.locator('#date').fill(date);
  await page.locator('#date').dispatchEvent('change');
}
async function synced(page) {
  await wait(async () => {
    const e = await entity(page);
    return e && !e.dirty;
  });
}
let previewServer;
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 2400 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((raw) => {
    if (!localStorage.getItem('anotar:journal:v1')) localStorage.setItem('anotar:journal:v1', raw);
  }, legacy);
  await page.goto(app.base + '/journal');
  await page.locator('#daySheet .day-hour').last().waitFor();
  await hooks(page);
  await prepareShell(page);
  await page.locator('#daySheet .day-hour').last().waitFor();
  await hooks(page);
  assert.equal(await page.locator('#daySheet .day-hour').count(), 24);
  await synced(page);
  const migrated = await entity(page);
  assert.equal(migrated.current.day.priorities[0].text, '이전 핵심');
  assert.equal(migrated.current.day.actual[0].title, '이전 실제 기록');
  assert.equal(await page.evaluate(() => localStorage.getItem('anotar:journal:v1')), legacy);
  const repeated = await page.evaluate(async () => {
    const r = await fixture.getWorkspaceRuntime();
    return fixture.migrateJournal(r.workspaceId, r.deviceId);
  });
  assert.deepEqual(repeated, { imported: 0, conflicts: 0 });
  checks.push('legacy migration is idempotent; exact original and hidden actual JSON remain');
  const target = page.locator('.day-hour[data-hour="22"] .hour-cell');
  await page
    .locator('.priority-text')
    .first()
    .dragTo(target, { targetPosition: { x: 10, y: 15 } });

  await wait(async () => (await entity(page)).current.day.plan.length === 1);
  await page
    .locator('.priority-text')
    .first()
    .dragTo(target, { targetPosition: { x: 450, y: 15 } });
  await wait(async () => (await entity(page)).current.day.plan.length === 2);
  let day = (await entity(page)).current.day;
  assert.equal(day.plan[0].priorityId, day.priorities[0].id);
  assert.equal(day.plan[1].priorityId, day.priorities[0].id);
  assert.equal(day.plan[0].priorityTitle, '이전 핵심');
  await page.locator('.priority-edit').first().click();
  await page.getByLabel('핵심 할 일 1', { exact: true }).fill('새 핵심 제목');
  await page.locator('#feedback').click();
  await wait(async () => (await entity(page)).current.day.priorities[0].text === '새 핵심 제목');
  assert.equal((await entity(page)).current.day.plan[0].priorityTitle, '이전 핵심');
  const firstId = (await entity(page)).current.day.plan[0].id;
  await page.locator(`.hour-entry[data-id="${firstId}"]`).first().click();
  await page.locator('#remove').click();
  await wait(async () => (await entity(page)).current.day.plan.length === 1);
  assert.equal((await entity(page)).current.day.priorities[0].text, '새 핵심 제목');
  await page.locator('.plan-slot').first().hover();
  await page.locator('.missed-action').first().click();
  await wait(async () => (await entity(page)).current.day.plan[0].missed === true);
  assert.equal((await entity(page)).current.day.priorities[0].done, false);
  checks.push(
    'desktop priority drop creates multiple linked plans; snapshots survive priority edit, plan deletion/missed leaves priority intact',
  );
  await page.locator('[data-view="week"]').click();
  assert.match(await page.locator('#periodTable').innerText(), /새 핵심 제목/);
  assert.match(await page.locator('#periodTable').innerText(), /기존 회고/);
  assert.match(await page.locator('#periodTable').innerText(), /이전 핵심/);
  await page.locator('[data-view="month"]').click();
  assert.match(
    await page.locator(`#periodReflections [data-date="${today}"]`).innerText(),
    /기존 회고/,
  );
  assert.ok((await page.locator('#periodReflections .reflection').count()) >= 28);
  checks.push(
    'weekly priorities/planned time/missed/feedback and monthly continuous dated feedback',
  );
  await page.locator('[data-view="review"]').click();
  await page.locator('.review-again').first().click();
  await page.locator('#entryDate').fill(addDays(today, 1));
  await page.locator('#start').fill('09:00');
  await page.locator('#end').fill('09:30');
  await page.locator('#entryForm button[type="submit"]').click();
  await wait(async () => Boolean(await entity(page, addDays(today, 1))));
  const original = (await entity(page)).current.day.plan[0],
    replan = (await entity(page, addDays(today, 1))).current.day.plan[0];
  assert.equal(original.missed, true);
  assert.notEqual(replan.id, original.id);
  assert.equal(replan.sourcePlan.id, original.id);
  assert.equal(replan.sourcePlan.date, today);
  assert.equal(replan.priorityId, original.priorityId);
  assert.equal(replan.missed, false);
  checks.push(
    'explicit plan-again creates a new dated linked plan and preserves original missed record',
  );
  await chooseDate(page, today);
  await synced(page);
  await context.setOffline(true);
  await page.locator('#brain').fill('오프라인으로 저장한 생각');
  await wait(async () => (await entity(page)).current.day.brain === '오프라인으로 저장한 생각');
  await page.reload();
  await page.locator('#daySheet .day-hour').last().waitFor();
  await hooks(page);
  assert.equal(await page.locator('#brain').inputValue(), '오프라인으로 저장한 생각');
  assert.equal((await entity(page)).dirty, true);
  await context.setOffline(false);
  await page.evaluate(() => fixture.requestWorkspaceSync());
  await wait(async () => (await serverDay()).day.brain === '오프라인으로 저장한 생각');
  checks.push('offline edit survives /journal reload and reconnect reaches server');
  const otherContext = await app.browser.newContext(),
    other = await otherContext.newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto(app.base + '/journal');
  await other.locator('#daySheet .day-hour').last().waitFor();
  await hooks(other);
  await context.setOffline(true);
  await page.locator('#feedback').fill('기기 A 오프라인 회고');
  await wait(async () => (await entity(page)).current.day.feedback === '기기 A 오프라인 회고');
  await other.locator('#feedback').fill('기기 B 서버 회고');
  await wait(async () => (await serverDay()).day.feedback === '기기 B 서버 회고');
  await context.setOffline(false);
  await page.evaluate(() => fixture.requestWorkspaceSync());
  await wait(
    async () =>
      await page.evaluate(async () => {
        const r = await fixture.getWorkspaceRuntime();
        return (await fixture.listRecords('conflicts', r.workspaceId, 100)).some(
          (c) =>
            c.local?.day?.feedback === '기기 A 오프라인 회고' &&
            c.server?.day?.feedback === '기기 B 서버 회고',
        );
      }),
  );
  const exported = await page.evaluate(async () => {
    const r = await fixture.getWorkspaceRuntime();
    return (await fixture.exportPendingWorkspace(r.workspaceId)).manifest;
  });
  assert.match(JSON.stringify(exported), /기기 A 오프라인 회고/);
  assert.match(JSON.stringify(exported), /기기 B 서버 회고/);
  assert.ok(exported.meta.some((m) => m.raw === legacy));
  assert.equal(await page.evaluate(() => localStorage.getItem('anotar:journal:v1')), legacy);
  checks.push(
    'cross-device conflict preserves local/base/server; recovery manifest includes journal JSON, links and exact migration archive',
  );
  await page.locator('.sync-status-trigger').click();
  await page.getByRole('button', { name: '양쪽 내용 확인', exact: true }).first().click();
  await page.getByRole('button', { name: '내 변경 보기', exact: true }).click();
  assert.match(await page.locator('.sync-conflict-preview').innerText(), /기기 A 오프라인 회고/);
  await page.getByRole('button', { name: '서버 내용 사용', exact: true }).click();
  await page.getByRole('button', { name: '동기화 상태 닫기' }).click();
  await page.locator('#date').focus();
  await wait(async () => (await entity(page)).current.day.feedback === '기기 B 서버 회고');
  checks.push('existing conflict dialog displays and explicitly resolves whole-day journal copies');
  await synced(page);
  await page.locator('#brain').focus();
  const visibleBase = (await entity(page)).base.version;
  const visibleIdea = await page.locator('#idea').inputValue();
  await other.locator('#idea').fill('다른 기기에서 갱신한 아이디어');
  await wait(async () => (await serverDay()).day.idea === '다른 기기에서 갱신한 아이디어');
  await page.evaluate(() => fixture.requestWorkspaceSync());
  await wait(async () => (await entity(page)).current.day.idea === '다른 기기에서 갱신한 아이디어');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#idea').inputValue(), visibleIdea);
  await context.setOffline(true);
  await page.locator('#brain').fill('포커스한 창에서 새로 쓴 생각');
  await wait(async () => (await entity(page)).current.day.brain === '포커스한 창에서 새로 쓴 생각');
  const staleOperation = await page.evaluate(async () => {
    const r = await fixture.getWorkspaceRuntime();
    return (await fixture.listRecords('outbox', r.workspaceId, 100)).find(
      (p) => p.operation.kind === 'journal.update',
    );
  });
  assert.equal(staleOperation.operation.baseVersion, visibleBase);
  await context.setOffline(false);
  await page.evaluate(() => fixture.requestWorkspaceSync());
  await wait(
    async () =>
      await page.evaluate(async () => {
        const r = await fixture.getWorkspaceRuntime();
        return (await fixture.listRecords('conflicts', r.workspaceId, 100)).some(
          (c) =>
            c.local?.day?.brain === '포커스한 창에서 새로 쓴 생각' &&
            c.server?.day?.idea === '다른 기기에서 갱신한 아이디어',
        );
      }),
  );
  assert.equal((await serverDay()).day.idea, '다른 기기에서 갱신한 아이디어');
  await page.locator('.sync-status-trigger').click();
  await page.getByRole('button', { name: '양쪽 내용 확인', exact: true }).first().click();
  await page.getByRole('button', { name: '서버 내용 사용', exact: true }).click();
  await page.getByRole('button', { name: '동기화 상태 닫기' }).click();
  await page.locator('#date').focus();
  await synced(page);
  checks.push(
    'clean focused editor retains the visible base; remote changes to other fields produce 409 instead of silent overwrite',
  );
  await context.setOffline(true);
  await page.locator('#brain').focus();
  const sameTab = await context.newPage();
  await sameTab.goto(app.base + '/journal');
  await sameTab.locator('#daySheet .day-hour').last().waitFor();
  await hooks(sameTab);
  await sameTab.locator('#brain').fill('같은 기기의 다른 창 내용');
  await wait(async () => (await entity(sameTab)).current.day.brain === '같은 기기의 다른 창 내용');
  await page.waitForTimeout(250);
  await page.locator('#brain').fill('현재 창에서 보존할 새 입력');
  await wait(async () => /다른 창/.test(await page.locator('#storageError').innerText()));
  assert.equal((await entity(page)).current.day.brain, '같은 기기의 다른 창 내용');
  assert.equal(await page.locator('#brain').inputValue(), '현재 창에서 보존할 새 입력');
  const editCopies = await page.evaluate(async () => {
    const r = await fixture.getWorkspaceRuntime();
    return await fixture.listRecords('meta', r.workspaceId, 1000);
  });
  assert.ok(
    editCopies.some(
      (copy) =>
        copy.local?.day?.brain === '현재 창에서 보존할 새 입력' &&
        copy.other?.day?.brain === '같은 기기의 다른 창 내용',
    ),
  );
  await sameTab.close();
  await page.reload();
  await page.locator('#daySheet .day-hour').last().waitFor();
  await hooks(page);
  await context.setOffline(false);
  await page.evaluate(() => fixture.requestWorkspaceSync());
  checks.push(
    'same-device tab conflict keeps other tab content, current visible input and archived edit copies',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await selectAppTheme(page, 'dark');
  await page.screenshot({ path: evidence + '/app-mobile-dark.png', fullPage: true });
  const geometry = await page.evaluate(() => {
    const r = document.querySelector('[aria-label="타임박싱 일지"] div').shadowRoot;
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      theme: r.host.dataset.theme,
      hours: r.querySelectorAll('.day-hour').length,
      priorityWidth: r.querySelector('.priority-row').getBoundingClientRect().width,
      paper: getComputedStyle(r.querySelector('.journal-body')).backgroundColor,
    };
  });
  assert.equal(geometry.theme, 'dark');
  assert.equal(geometry.paper, 'rgb(27, 30, 29)');
  assert.equal(geometry.hours, 24);
  assert.ok(geometry.pageWidth <= geometry.viewport + 1);
  checks.push('390px dark app retains 24h and no viewport overflow');
  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator('.priority-plan').first().click();
  const narrowGeometry = await page.evaluate(() => {
    const root = document.querySelector('[aria-label="타임박싱 일지"] div').shadowRoot;
    const dialog = root.querySelector('#entryDialog').getBoundingClientRect();
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      dialogLeft: dialog.left,
      dialogRight: dialog.right,
      hours: root.querySelectorAll('.day-hour').length,
    };
  });
  assert.equal(narrowGeometry.hours, 24);
  assert.ok(narrowGeometry.pageWidth <= narrowGeometry.viewport + 1);
  assert.ok(narrowGeometry.dialogLeft >= 0 && narrowGeometry.dialogRight <= 321);
  await page.screenshot({ path: evidence + '/app-320-dark-dialog.png', fullPage: true });
  await page.locator('#closeDialog').click();
  checks.push('320px app retains 24h; accessible linked-plan dialog stays inside viewport');
  const collisionContext = await app.browser.newContext(),
    collision = await collisionContext.newPage();
  const collisionRaw = JSON.stringify({
    theme: 'dark',
    days: { [today]: { ...empty(), feedback: '가져온 옛 회고' } },
  });
  await collision.addInitScript(
    (raw) => localStorage.setItem('anotar:journal:v1', raw),
    collisionRaw,
  );
  await collision.goto(app.base + '/journal');
  await collision.locator('#daySheet .day-hour').last().waitFor();
  await hooks(collision);
  const collisionData = await collision.evaluate(async () => {
    const r = await fixture.getWorkspaceRuntime();
    return {
      conflicts: await fixture.listRecords('conflicts', r.workspaceId, 100),
      manifest: (await fixture.exportPendingWorkspace(r.workspaceId)).manifest,
      raw: localStorage.getItem('anotar:journal:v1'),
    };
  });
  assert.ok(
    collisionData.conflicts.some(
      (c) =>
        c.local?.day?.feedback === '가져온 옛 회고' &&
        c.server?.day?.feedback === '기기 B 서버 회고',
    ),
  );
  assert.equal(collisionData.raw, collisionRaw);
  assert.ok(collisionData.manifest.meta.some((m) => m.previous?.length));
  assert.equal((await serverDay()).day.feedback, '기기 B 서버 회고');
  checks.push(
    'legacy date collision requires review; source and previous entity/pending copies are archived without server overwrite',
  );
  const allowed = new Set([
    '/docs/design/timeboxing-preview.html',
    '/docs/design/timeboxing-preview.css',
    '/docs/design/timeboxing-preview.mjs',
    '/docs/design/timeboxing-model.mjs',
    '/src/journal/controller.mjs',
    '/src/journal/dragTime.mjs',
    '/shared/journal.mjs',
    '/favicon.png',
  ]);
  previewServer = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!allowed.has(path)) {
      res.writeHead(404);
      return res.end();
    }
    try {
      const bytes = await readFile(path === '/favicon.png' ? 'public/favicon.png' : '.' + path);
      res.setHeader(
        'Content-Type',
        path.endsWith('.mjs')
          ? 'application/javascript'
          : path.endsWith('.css')
            ? 'text/css'
            : path.endsWith('.png')
              ? 'image/png'
              : 'text/html',
      );
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => previewServer.listen(0, '127.0.0.1', r));
  const previewContext = await app.browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
    }),
    preview = await previewContext.newPage();
  preview.on('pageerror', (e) => errors.push(e.message));
  await preview.goto(
    `http://127.0.0.1:${previewServer.address().port}/docs/design/timeboxing-preview.html`,
  );
  await preview.locator('#daySheet .day-hour').last().waitFor();
  assert.equal(await preview.locator('#daySheet .day-hour').count(), 24);
  await preview.locator('[data-view="month"]').click();
  assert.equal(await preview.locator('#periodReflections .reflection').count(), 31);
  await preview.screenshot({ path: evidence + '/preview-mobile-dark.png', fullPage: true });
  assert.equal(await preview.evaluate(() => localStorage.getItem('anotar:journal:v1')), null);
  checks.push(
    'actual standalone preview modules work at 390px dark, retain sample and use independent storage',
  );
  await preview.setViewportSize({ width: 320, height: 720 });
  await preview.locator('[data-view="day"]').click();
  assert.ok(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await preview.locator('#daySheet .day-hour').count(), 24);
  checks.push('320px standalone preview retains 24h with no viewport overflow');
  assert.deepEqual(errors, []);
  await writeFile(
    evidence + '/verification.json',
    JSON.stringify({ status: 'PASS', today, checks, geometry, narrowGeometry, errors }, null, 2),
  );
  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
} finally {
  if (previewServer) await new Promise((r) => previewServer.close(r));
  await app.close();
}
