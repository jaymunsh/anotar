import { AI_ERRORS } from './ai/contracts.mjs';

function scrub(value, token = '') {
  let text = String(value || '');
  if (token) text = text.split(token).join('[비밀정보제외]');
  return text
    .replace(/\bBearer\s+[a-z0-9._~+/-]+=*/gi, '[비밀정보제외]')
    .replace(/\b(?:[a-z][a-z0-9_]*(?:token|secret|password|api_key)|token|secret|password|api[_ -]?key|authorization)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, '[비밀정보제외]')
    .replace(/\bsk-[a-z0-9_-]{12,}/gi, '[비밀정보제외]')
    .replace(/\b\d{6,}:[a-z0-9_-]{20,}\b/gi, '[비밀정보제외]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function short(value, token) {
  const chars = Array.from(scrub(value, token));
  return chars.slice(0, 80).join('') + (chars.length > 80 ? '…' : '');
}
function appOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : '';
  } catch { return ''; }
}
export function formatAiNotification(event, job, { preview = false, token = '', origin = '', errorCode } = {}) {
  const execution = job.request?.execution;
  const lines = [event === 'failed' ? 'Anotar · AI 요청 실패' : 'Anotar · AI 요청 시작'];
  lines.push(`모델: ${short(execution?.model || job.runner?.label || '설정된 실행기', token)}`);
  lines.push(`템플릿: ${short(job.request?.template?.name || '직접 요청', token)}`);
  lines.push(preview
    ? `요청: ${short(job.request?.input?.content || job.request?.input?.url || '텍스트 없음', token)}`
    : '요청: 본문 미리보기 꺼짐');
  if (event === 'failed') lines.push(`사유: ${Object.hasOwn(AI_ERRORS, errorCode) ? AI_ERRORS[errorCode] : AI_ERRORS.runner_failed}`);
  const base = appOrigin(origin);
  if (base && (job.pageId || job.captureId)) {
    lines.push(`${base}/${job.pageId ? 'pages' : 'captures'}/${encodeURIComponent(job.pageId || job.captureId)}?aiJob=${encodeURIComponent(job.id)}`);
  }
  return lines.join('\n');
}

// Best effort, bounded in-memory queue; Telegram never delays or retries the AI job.
export function createServiceNotifier({ env = process.env, fetchImpl = fetch, log = code => console.warn(`service_notification:${code}`), maxPending = 40, timeoutMs = 3000 } = {}) {
  const token = env.SERVICE_TELEGRAM_BOT_TOKEN || '', chatId = env.SERVICE_TELEGRAM_CHAT_ID || '';
  const requested = env.SERVICE_TELEGRAM_ENABLED === 'true';
  const enabled = requested && /^\d{6,}:[a-z0-9_-]{20,}$/i.test(token) && /^-?\d{1,20}$/.test(chatId);
  if (requested && !enabled) log('config_invalid');
  const queue = [];
  let pending = 0, pumping = null, controller = null, stopped = false;
  async function send(text) {
    controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        log('telegram_rejected');
        return;
      }
      let size = 0;
      const parts = [];
      for await (const part of response.body) {
        size += part.length;
        if (size > 65536) throw Error();
        parts.push(part);
      }
      if (JSON.parse(Buffer.concat(parts).toString('utf8')).ok !== true) log('telegram_rejected');
    } catch {
      log(stopped ? 'shutdown_cancelled' : 'transport_failed');
    } finally {
      clearTimeout(timer);
      controller = null;
    }
  }
  function pump() {
    if (pumping || stopped) return;
    pumping = Promise.resolve().then(async () => {
      while (queue.length && !stopped) {
        const text = queue.shift();
        try { await send(text); } finally { pending--; }
      }
    }).finally(() => { pumping = null; if (queue.length && !stopped) pump(); });
  }
  return {
    enabled,
    notify(event, job, errorCode) {
      if (!enabled || stopped || !['started', 'failed'].includes(event)) return false;
      if (pending >= maxPending) { log('queue_full'); return false; }
      queue.push(formatAiNotification(event, job, {
        preview: env.SERVICE_TELEGRAM_PREVIEW === 'true', token,
        origin: env.SERVICE_TELEGRAM_APP_URL || '', errorCode,
      }));
      pending++;
      pump();
      return true;
    },
    async drain() { while (pumping) await pumping; },
    async close() {
      stopped = true;
      pending -= queue.length;
      queue.length = 0;
      controller?.abort();
      await this.drain();
    },
  };
}
