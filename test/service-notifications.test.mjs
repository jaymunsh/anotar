import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceNotifier, formatAiNotification } from '../server/serviceNotifications.mjs';

const token = '123456789:abcdefghijklmnopqrstuvwxyz0123456789';
const env = {
  SERVICE_TELEGRAM_ENABLED: 'true', SERVICE_TELEGRAM_BOT_TOKEN: token,
  SERVICE_TELEGRAM_CHAT_ID: '-123456789', SERVICE_TELEGRAM_PREVIEW: 'true',
  SERVICE_TELEGRAM_APP_URL: 'https://anotar.example',
};
const job = {
  id: 'job-1', captureId: 'memo-1', pageId: null,
  request: { input: { content: '회의 내용을 간단히 정리해줘' }, execution: { profileId: 'opencode', model: 'opencode/space-bunny-free' }, template: { name: '직접 요청' } },
};
test('notification previews are bounded, redact common credentials before truncation, and can be disabled', () => {
  const sensitive = { ...job, request: { ...job.request, input: { content: `HIVE_API_KEY=sk-abcdefghijklmnopqrst TOKEN=${token} Authorization: Bearer abcdef123456\n${'기록'.repeat(100)}` } } };
  const message = formatAiNotification('failed', sensitive, { preview: true, token, origin: env.SERVICE_TELEGRAM_APP_URL, errorCode: 'runner_authentication' });
  assert.doesNotMatch(message, /sk-abcdefghijklmnopqrst|abcdefghijklmnopqrstuvwxyz0123456789|abcdef123456/);
  assert.match(message, /AI 요청 실패/);
  assert.match(message, /AI 인증/);
  assert.match(message, /https:\/\/anotar.example\/captures\/memo-1\?aiJob=job-1/);
  assert.ok(Array.from(message.split('\n').find(line => line.startsWith('요청: ')).slice(4)).length <= 81);
  const hidden = formatAiNotification('started', job, { preview: false });
  assert.doesNotMatch(hidden, /회의 내용을/);
  assert.match(hidden, /미리보기 꺼짐/);
  const pageMessage = formatAiNotification('failed', { ...job, pageId: 'page-1' }, { origin: 'https://anotar.example', errorCode: token });
  assert.match(pageMessage, /\/pages\/page-1\?aiJob=job-1/);
  assert.doesNotMatch(pageMessage, /abcdefghijklmnopqrstuvwxyz0123456789/);
});
test('start/failure delivery is ordered, uses one bounded POST each, and never retries or forwards raw failures', async () => {
  const calls = [], logs = [];
  const notifier = createServiceNotifier({ env, log: code => logs.push(code), fetchImpl: async (url, options) => {
    calls.push({ url, options, payload: JSON.parse(options.body) });
    if (calls.length === 1) throw new Error('https://api.telegram.org/bot'+token+'/sendMessage');
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } });
  notifier.notify('started', job);
  notifier.notify('failed', job, 'timeout');
  await notifier.drain();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.telegram.org/bot'+token+'/sendMessage');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].payload.chat_id, '-123456789');
  assert.equal(calls[0].payload.link_preview_options.is_disabled, true);
  assert.equal(calls[0].payload.parse_mode, undefined);
  assert.match(calls[0].payload.text, /AI 요청 시작/);
  assert.match(calls[1].payload.text, /AI 요청 실패/);
  assert.deepEqual(logs, ['transport_failed']);
  await notifier.close();
});
test('notifications default to off; invalid config and saturated queues do not send extra messages', async () => {
  let calls = 0;
  const off = createServiceNotifier({ env: {}, fetchImpl: async () => { calls++; } });
  assert.equal(off.notify('started', job), false);
  await off.drain();
  assert.equal(calls, 0);
  const invalid = createServiceNotifier({ env: { ...env, SERVICE_TELEGRAM_CHAT_ID: 'not-a-chat' } });
  assert.equal(invalid.enabled, false);
  const held = [];
  const notifier = createServiceNotifier({ env, maxPending: 2, log: code => held.push(code), fetchImpl: async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ ok: true }));
  } });
  assert.equal(notifier.notify('started', job), true);
  assert.equal(notifier.notify('failed', job), true);
  assert.equal(notifier.notify('started', job), false);
  await notifier.drain();
  assert.deepEqual(held, ['queue_full']);
  await notifier.close();
});

test('quoted JSON credentials are redacted and inherited error names use a fixed failure reason', () => {
  for (const content of ['{"api_key":"synthetic-json-api-credential"}', '{"password":"synthetic-json-password"}', "{'secret':'synthetic-json-secret'}"]) {
    const text = formatAiNotification('failed', { ...job, request: { ...job.request, input: { content } } }, { preview: true, errorCode: 'toString' });
    assert.doesNotMatch(text, /synthetic-json|function toString/);
    assert.match(text, /비밀정보제외/);
  }
});
