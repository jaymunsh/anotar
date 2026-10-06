import { createHash } from 'node:crypto';

export class AiValidationError extends Error {}
export class AiConflictError extends Error {}
export class AiNotFoundError extends Error {}
export class AiExecutionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const AI_OUTPUT_LIMIT = 256 * 1024;
export const AI_ERRORS = {
  runner_authentication: 'AI 인증을 확인해 주세요. 설정한 키나 CLI 로그인이 만료됐을 수 있어요.',
  runner_rate_limit: 'AI 사용 한도나 잔액을 확인해 주세요. 자동으로 다른 실행기를 사용하지 않아요.',
  runner_unavailable: 'AI 실행기가 아직 연결되지 않았어요. 메모와 요청문은 보관했어요.',
  unsupported_input:
    '아직 첨부 파일만으로는 실행할 수 없어요. 처리할 글이나 URL을 함께 적어 주세요.',
  timeout: '처리 시간이 초과됐어요. 자동으로 다시 실행하지 않아요.',
  interrupted: '서버가 종료되어 처리 결과를 확인하지 못했어요. 필요하면 다시 요청해 주세요.',
  source_deleted: '원본이 휴지통으로 이동되어 실행을 취소했어요.',
  research_blocked: '공개 HTTP·HTTPS 주소만 리서치할 수 있어요.',
  research_failed: '링크의 본문을 가져오지 못했어요. 원문 접근 가능 여부를 확인해 주세요.',
  research_too_large: '리서치 자료가 크기 제한을 초과했어요.',
  research_search_unavailable:
    '현재 실행기는 키워드 검색을 지원하지 않아요. URL을 입력하거나 검색 가능한 OpenCode·Devin 실행기를 선택해 주세요.',
  research_no_sources:
    '검색한 자료의 본문을 확인하지 못했어요. 주제를 구체적으로 적거나 공개 URL로 다시 요청해 주세요.',
  invalid_result: 'AI 응답 형식이 올바르지 않아 결과를 저장하지 않았어요.',
  runner_failed: 'AI 실행에 실패했어요. 원본과 요청문은 보관했어요.',
};

export function cleanRequestId(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    throw new AiValidationError('요청 식별자가 올바르지 않아요.');
  return value.toLowerCase();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const fingerprint = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export function captureFingerprint({ kind, text, url, files, aiRequest }) {
  return fingerprint({
    kind,
    text,
    url,
    aiRequest,
    files: files.map(({ name, mime, size, sha256 }) => {
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))
        throw new AiValidationError('파일 내용을 확인하지 못했어요. 다시 첨부해 주세요.');
      return { name, mime, size, sha256 };
    }),
  });
}

export function validateAiResult(value, { materials = [], kind = 'free' } = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.markdown !== 'string' ||
    !value.markdown.trim() ||
    Buffer.byteLength(JSON.stringify(value)) > AI_OUTPUT_LIMIT
  )
    throw new AiExecutionError('invalid_result');
  if (value.sources !== undefined && (!Array.isArray(value.sources) || value.sources.length > 20))
    throw new AiExecutionError('invalid_result');
  const sources = (value.sources || []).map((source) => {
    if (
      !source ||
      typeof source.url !== 'string' ||
      source.url.length > 2048 ||
      (source.title !== undefined &&
        (typeof source.title !== 'string' || source.title.length > 200))
    )
      throw new AiExecutionError('invalid_result');
    let url;
    try {
      url = new URL(source.url);
    } catch {
      throw new AiExecutionError('invalid_result');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new AiExecutionError('invalid_result');
    if (kind === 'research' && !materials.some((item) => item.url === url.href))
      throw new AiExecutionError('invalid_result');
    return { url: url.href, title: source.title || url.hostname, verified: false, fetchedAt: null };
  });
  const verified = materials.map(({ url, title, fetchedAt }) => ({
    url,
    title,
    fetchedAt,
    verified: true,
  }));
  let usage = null;
  if (value.usage != null) {
    if (
      typeof value.usage !== 'object' ||
      !['inputTokens', 'outputTokens'].every(
        (key) =>
          value.usage[key] == null ||
          (Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0),
      )
    )
      throw new AiExecutionError('invalid_result');
    usage = {
      inputTokens: value.usage.inputTokens ?? null,
      outputTokens: value.usage.outputTokens ?? null,
    };
  }
  return {
    markdown: value.markdown.trim(),
    sources: kind === 'research' ? verified : sources,
    usage,
  };
}
