import { useEffect, useRef } from 'react';
import { ChevronDown, Settings2 } from 'lucide-react';
import type { AiExecution } from '../../shared/aiRequests';
import { useAiProfiles } from './useAiProfiles';
import { describeExecution } from './executionPresentation';
import './ai.css';
import '../prompts/aiRequestFields.css';
export default function AiExecutionPicker({
  value,
  onChange,
  onAvailability,
  research = false,
  hasUrl = false,
}: {
  value?: AiExecution | null;
  onChange: (value: AiExecution) => void;
  onAvailability?: (enabled: boolean) => void;
  research?: boolean;
  hasUrl?: boolean;
}) {
  const { settings, error, reload } = useAiProfiles();
  const callbacks = useRef({ onChange, onAvailability });
  callbacks.current = { onChange, onAvailability };
  const { profile, stale, unsupported, reason, usable: configured } = describeExecution(settings, value, research, hasUrl);
  const usable = configured && !error;
  useEffect(() => {
    if (!value && profile)
      callbacks.current.onChange({ profileId: profile.id, model: profile.model });
  }, [value, profile?.id, profile?.model]);
  useEffect(() => {
    callbacks.current.onAvailability?.(usable);
  }, [usable]);
  return (
    <div className="ai-execution-picker ai-execution-compact">
      <div className="ai-execution-overview">
        <div className="ai-execution-current" title={`${profile?.label || ''} · ${value?.model || profile?.model || ''}`}>
          <strong>{profile?.label || 'AI 연결 확인 중'}</strong>
          <span>{value?.model || profile?.model || '모델 설정 필요'}</span>
        </div>
        <span className={`ai-execution-state ${usable ? 'ready' : ''}`} role="status">{usable ? '실행 가능' : !settings && !error ? '확인 중' : '연결 확인 필요'}</span>
        <button type="button" className="ai-settings-link" aria-label="AI 설정 열기" title="AI 설정 열기"
          onClick={() => window.dispatchEvent(new Event('anotar:open-ai-settings'))}><Settings2 size={16} /></button>
      </div>
      <details className="ai-execution-options">
        <summary>모델 변경 <ChevronDown size={14} aria-hidden="true" /></summary>
        <div className="ai-execution-controls">
        <label>
          <span>실행기 · 모델</span>
          <select
            aria-label="AI 실행기와 모델"
            value={
              stale
                ? 'stale'
                : value?.profileId === 'opencode'
                  ? `opencode|${value.model}`
                  : value?.profileId || profile?.id || ''
            }
            disabled={!settings}
            onChange={(e) => {
              const [id, selectedModel] = e.target.value.split('|');
              const next = settings?.profiles.find((p) => p.id === id);
              if (next) onChange({ profileId: next.id, model: selectedModel || next.model });
            }}
          >
            {!settings && <option value="">설정 확인 중</option>}
            {stale && (
              <option value="stale">
                {profile?.label} · {value?.model} (설정 변경됨)
              </option>
            )}
            {settings?.profiles.map((p) =>
              p.id === 'opencode' ? (
                <optgroup key={p.id} label={p.label}>
                  {!p.catalog?.some((m) => m.enabled) && (
                    <option value={p.id}>OpenCode · 모델 설정 필요</option>
                  )}
                  {p.catalog
                    ?.filter((m) => m.enabled)
                    .map((m) => (
                      <option key={m.id} value={`opencode|${m.id}`}>
                        OpenCode · {m.name} ·{' '}
                        {m.pricing === 'free'
                          ? '무료 등록'
                          : m.pricing === 'paid'
                            ? '유료'
                            : '가격 확인 필요'}
                        {p.enabled ? '' : ' · 연결 필요'}
                      </option>
                    ))}
                </optgroup>
              ) : (
                <option key={p.id} value={p.id}>
                  {p.label} · {p.model || '모델 설정 필요'}
                  {p.enabled ? '' : ' · 연결 필요'}
                </option>
              ),
            )}
          </select>
        </label>
        </div>
      </details>
      {error ? (
        <p role="status">
          {error}{' '}
          <button type="button" onClick={reload}>
            다시 확인
          </button>
        </p>
      ) : stale ? (
        <p role="status">모델 설정이 바뀌었어요. 실행기를 다시 선택해 주세요.</p>
      ) : unsupported ? (
        <p role="status">
          {profile?.label}는 키워드 검색이 연결되지 않았어요. URL을 입력해 자료를 읽거나,
          ‘직접 요청’으로 작성한 글을 정리할 수 있어요.
        </p>
      ) : profile && !profile.enabled ? (
        <p role="status">
          {profile.status === 'disabled'
            ? profile.id === 'opencode'
              ? '서버에서 OpenCode 실행을 켜고 설치·인증을 확인해 주세요.'
              : '서버에서 AI 실행이 꺼져 있어요.'
            : profile.status === 'login_required'
              ? '서버에서 Devin 로그인이 필요해요.'
              : '서버의 키·모델 또는 CLI 설정을 확인해 주세요.'}
        </p>
      ) : reason === 'model' ? <p role="status">사용할 모델을 선택해 주세요. 설정에서 모델을 등록할 수 있어요.</p> : null}
    </div>
  );
}
