import { useEffect, useRef } from 'react';
import { Settings2 } from 'lucide-react';
import type { AiExecution } from '../../shared/aiRequests';
import { useAiProfiles } from './useAiProfiles';
import './ai.css';
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
  const profile = settings?.profiles.find(
    (p) => p.id === (value?.profileId || settings.defaultProfile),
  );
  const stale = Boolean(
    value &&
    profile &&
    (profile.id === 'opencode'
      ? !profile.catalog?.some((m) => m.id === value.model && m.enabled)
      : value.model !== profile.model),
  );
  const unsupported = Boolean(
    research && profile && !profile.researchModes.includes(hasUrl ? 'url' : 'keyword'),
  );
  const usable = Boolean(value && profile?.enabled && !stale && !unsupported);
  useEffect(() => {
    if (!value && profile)
      callbacks.current.onChange({ profileId: profile.id, model: profile.model });
  }, [value, profile?.id, profile?.model]);
  useEffect(() => {
    callbacks.current.onAvailability?.(usable);
  }, [usable]);
  return (
    <div className="ai-execution-picker">
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
        <button
          type="button"
          className="ai-settings-link"
          aria-label="AI 설정 열기"
          onClick={() => window.dispatchEvent(new Event('anotar:open-ai-settings'))}
        >
          <Settings2 size={16} />
        </button>
      </div>
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
          키워드 자료 조사는 Devin CLI가 필요해요. 현재 실행기에서는 URL을 입력하거나 직접 요청을
          선택해 주세요.
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
      ) : (
        <p>첨부 파일은 전송하지 않아요. 요청 후 설정을 바꿔도 이 요청의 모델은 유지돼요.</p>
      )}
    </div>
  );
}
