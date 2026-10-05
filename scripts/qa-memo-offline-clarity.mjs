import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
// Isolated component fixtures: no application server, user data, keys or external requests.
const snapshot = {
  state: 'offline',
  pending: 1,
  conflicts: 0,
  error: '',
  lastSync: Date.parse('2026-10-05T00:00:00Z'),
};
const result = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import CapturePageImport from './src/memos/CapturePageImport'; import OfflinePageControl from './src/offline/OfflinePageControl'; import {SyncStatus} from './src/sync/SyncStatus'; window.fixture={kind:new URLSearchParams(location.search).get('mode')||'queue',pin:new URLSearchParams(location.search).get('mode')==='app'?{state:'partial',missing:[{id:'app',error:'앱 준비 실패'}]}:{state:'partial',missing:[{id:'asset-1',error:'첨부 다운로드 실패'}],successfulVersion:2,version:2}}; function App(){return <><CapturePageImport capture={{id:'memo-1',text:'여행 메모',url:'',files:[]}} expanded={true} onExpand={()=>{}} onBack={()=>window.returned=true} onBusy={()=>{}} navigate={()=>{}}/><OfflinePageControl pageId="page-1"/><SyncStatus/></>};createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  outfile: 'fixture.js',
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  plugins: [
    {
      name: 'fixtures',
      setup(b) {
        b.onResolve(
          {
            filter:
              /\/(workflows|runtime|repository|pageCache|ConflictPanel|RecoveryPanel|AppUpdateNotice)$/,
          },
          (a) => ({ path: a.path, namespace: 'fixtures' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'fixtures' }, (a) => ({
          contents: a.path.endsWith('/workflows')
            ? `export const replaceRejectedWrite=async()=>{}; export const useQueuedWorkflows=()=>window.fixture.kind==='review'?[]:[{state:'queued',operation:{kind:'capture.organize',payload:{target:{title:'여행 계획',newPageId:'new-page'}},operationId:'operation-1'}}]; export const queueWorkflow=async()=>{throw Error('Unexpected duplicate')};export const workflowResult=async()=>undefined;`
            : a.path.endsWith('/runtime')
              ? `export const getWorkspaceRuntime=async()=>({workspaceId:'fixture'});export const listLocalEntities=async()=>[];const status=${JSON.stringify(snapshot)};export const getSyncSnapshot=()=>status;export const subscribeSync=()=>()=>{};export const requestWorkspaceSync=async()=>{};`
              : a.path.endsWith('/repository')
                ? `export const subscribeLocalChanges=()=>()=>{};export const listRecords=async()=>[];export const readRecord=async()=>window.fixture.pin;`
                : a.path.endsWith('/pageCache')
                  ? `export const getOfflineAvailability=async()=>window.fixture.pin.state;export const pinPage=async()=>window.fixture.pin;export const unpinPage=async()=>{};`
                  : `export default function Component(){return null}`,
          loader: 'js',
        }));
      },
    },
  ],
});
const js =
  result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? result.outputFiles[0].text;
const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<style>:root{--theme-line:#ddd;--theme-ink:#292929;--theme-muted:#666;--theme-accent:#8a5742;--theme-soft:#f4eeeb;--theme-surface:#fff;--theme-canvas:#fff}body{font-family:system-ui;margin:20px;max-width:500px}*{box-sizing:border-box}' +
      css +
      '</style><div id="root"></div><script>' +
      js +
      '</script>',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.route('**/api/**', (r) => r.fulfill({ json: { items: [], nextCursor: null } }));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('정리 요청을 기기에 저장했어요', { exact: true }).waitFor({ timeout: 2500 });
  assert.equal(
    await page.getByRole('button', { name: '선택한 페이지에 추가', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: '메모로 돌아가기', exact: true }).last().click();
  assert.equal(await page.evaluate(() => window.returned), true);
  await page.getByText('첨부 1개를 아직 보관하지 못했어요.', { exact: true }).waitFor();
  await page.getByText(/마지막 완전 보관본/).waitFor();
  await page.getByRole('button', { name: '동기화 상태', exact: true }).click();
  await page.getByText('서버 연결 대기 · 기기에 저장한 변경 1건', { exact: true }).waitFor();
  await page.getByText(/마지막 서버 확인/).waitFor();
  await mkdir('.omo/evidence/memo-offline-clarity', { recursive: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: '.omo/evidence/memo-offline-clarity/queued-partial-mobile.png',
    fullPage: true,
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=app`);
  await page.getByText(/앱 실행 파일이 준비되지 않아/).waitFor();
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=review`);
  await page.getByRole('button', { name: '새 페이지', exact: true }).click();
  await page.getByRole('textbox', { name: '새 페이지 제목', exact: true }).fill('여행 계획');
  await page.getByText('새 문서: 여행 계획 · 내 페이지 · 메모 내용', { exact: true }).waitFor();
  await page.screenshot({
    path: '.omo/evidence/memo-offline-clarity/review-mobile.png',
    fullPage: true,
  });
  console.log(
    'PASS: queued memo receipt blocks duplicate organization, return action, partial attachment and last complete pin, offline sync waiting and last server check',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
