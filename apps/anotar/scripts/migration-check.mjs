import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function inspectDeploymentConfig(config) {
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  const storage = config?.services?.storage, share = config?.services?.share;
  check('개인·공개 서비스 구분', storage && share);
  if (storage && share) {
    check('개인 포트 루프백 제한', storage.ports?.length > 0 && storage.ports.every((p) => p.host_ip === '127.0.0.1'));
    check('공개 원본 포트 루프백 제한', share.ports?.length > 0 && share.ports.every((p) => p.host_ip === '127.0.0.1'));
    check('공개 프로세스 읽기 전용', share.read_only === true);
    check('공개 DB 읽기 전용', share.volumes?.some((v) => v.target === '/data' && v.read_only === true));
    check('공개 댓글 전용 socket', share.volumes?.some((v) => v.target === '/run/leneu' && v.read_only === true));
    check('공개 백업 볼륨 차단', !share.volumes?.some((v) => ['/backups', '/migration'].includes(v.target)));
    check('공개 AI·OCR·지도 키 차단', !Object.keys(share.environment || {}).some((key) => /^(AI_|OCR_|GOOGLE_|BACKUP_)/.test(key)));
    check('공개 개인 네트워크 차단', !Object.keys(share.networks || {}).some((key) => Object.hasOwn(storage.networks || {}, key)));
    check('공유 Origin 일치', Boolean(storage.environment?.PUBLIC_SHARE_ORIGIN) && storage.environment.PUBLIC_SHARE_ORIGIN === share.environment?.PUBLIC_SHARE_ORIGIN);
    check('개인 데이터·백업 볼륨', ['/data', '/backups'].every((target) => storage.volumes?.some((v) => v.target === target && !v.read_only)));
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export async function checkDeploymentEndpoints({ privateBase = 'http://127.0.0.1:8787', publicBase = 'http://127.0.0.1:8790', fetcher = fetch } = {}) {
  const checks = [];
  for (const [name, base, path, expected, health] of [
    ['개인 서버 상태', privateBase, '/api/health', 200, true],
    ['개인 페이지 조회', privateBase, '/api/pages', 200],
    ['개인 할 일 조회', privateBase, '/api/tasks?limit=1', 200],
    ['개인 백업 상태', privateBase, '/api/backups', 200],
    ['공개 서버 상태', publicBase, '/health', 200, true],
    ['공개 개인 페이지 API 차단', publicBase, '/api/pages', 404],
    ['공개 할 일 API 차단', publicBase, '/api/tasks', 404],
    ['공개 백업 API 차단', publicBase, '/api/backups', 404],
    ['공개 댓글 받은함 차단', publicBase, '/api/shared-comments', 404],
    ['공개 수집 worker 차단', publicBase, '/capture-worker.js', 404],
  ]) {
    try {
      const response = await fetcher(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'Cache-Control': 'no-cache' } });
      const ok = response.status === expected && (!health || (await response.json()).ok === true);
      await response.body?.cancel().catch(() => {});
      checks.push({ name, ok, status: response.status });
    } catch { checks.push({ name, ok: false, status: null }); }
  }
  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const args = process.argv.slice(2);
  let report;
  if (args[0] === '--compose') {
    const run = promisify(execFile);
    const files = args.slice(1).length ? args.slice(1) : ['compose.yaml'];
    const { stdout } = await run('docker', ['compose', ...files.flatMap((file) => ['-f', file]), 'config', '--format', 'json'], { maxBuffer: 2 * 1024 * 1024 });
    report = inspectDeploymentConfig(JSON.parse(stdout));
  } else {
    report = await checkDeploymentEndpoints({ privateBase: args[0], publicBase: args[1] });
  }
  for (const check of report.checks) console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}${check.status === undefined ? '' : ` (${check.status ?? '연결 실패'})`}`);
  console.log(report.ok ? '이전 확인 통과 — 실제 TLS·기기 재부팅·외부 백업은 서버에서 별도 확인하세요.' : '이전 확인 실패 — 위 항목을 수정한 뒤 다시 실행하세요.');
  process.exitCode = report.ok ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('이전 설정을 확인하지 못했습니다. Docker 실행·Compose 파일·서비스 주소를 확인하세요.'); process.exitCode = 1; });
