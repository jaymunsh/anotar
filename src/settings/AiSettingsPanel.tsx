import OpenCodeModels from './OpenCodeModels';
import { useEffect, useState } from 'react';
import { onlineActionFetch } from '../sync/onlineActions';
import { useAiProfiles, type AiSettings } from '../ai/useAiProfiles';
export default function AiSettingsPanel() {
  const { settings, error: loadError, reload } = useAiProfiles();
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (settings) setDraft((current) => current || settings);
  }, [settings]);
  async function save() {
    if (!draft || busy || catalogBusy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await onlineActionFetch('/api/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: draft.version,
          defaultProfile: draft.defaultProfile,
          models: Object.fromEntries(draft.profiles.map((p) => [p.id, p.model.trim()])),
          opencodeModels: draft.profiles.find((p) => p.id === 'opencode')?.catalog,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'AI 설정을 저장하지 못했어요.');
      setDraft(result);
      setNotice('저장했어요. 새 요청부터 적용됩니다.');
      window.dispatchEvent(new Event('anotar:ai-settings-changed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 설정을 저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-ai" aria-labelledby="settings-ai-title">
      <h3 id="settings-ai-title">AI</h3>
      <p className="settings-description">기본 실행기와 모델을 정하고, 요청할 때 바꿀 수 있어요.</p>
      {!draft ? (
        <p role="status">
          {loadError || '설정을 불러오는 중…'}
          {loadError && <button onClick={reload}>다시 불러오기</button>}
        </p>
      ) : (
        <>
          <label className="settings-ai-field">
            <span>기본 실행기</span>
            <select
              aria-label="기본 AI 실행기"
              value={draft.defaultProfile}
              disabled={busy}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  defaultProfile: e.target.value as AiSettings['defaultProfile'],
                })
              }
            >
              {draft.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {draft.profiles
            .filter((p) => p.id !== 'http')
            .map((profile) => (
              <div key={profile.id} className="settings-ai-provider">
                <div className="settings-ai-provider-heading">
                  <strong>{profile.label}</strong>
                  <span>
                    {profile.status === 'configured'
                      ? '설정됨'
                      : profile.status === 'disabled'
                        ? '실행 꺼짐'
                        : profile.status === 'login_required'
                          ? '로그인 필요'
                          : '연결 설정 필요'}
                  </span>
                </div>
                {profile.id === 'opencode' ? (
                  <OpenCodeModels
                    models={profile.catalog || []}
                    defaultModel={profile.model}
                    disabled={busy}
                    onBusyChange={setCatalogBusy}
                    onChange={(catalog, model) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              profiles: current.profiles.map((p) =>
                                p.id === 'opencode' ? { ...p, catalog, model } : p,
                              ),
                            }
                          : current,
                      )
                    }
                  />
                ) : (
                  <label className="settings-ai-field">
                    <span>모델 ID</span>
                    <input
                      aria-label={`${profile.label} 모델 ID`}
                      value={profile.model}
                      maxLength={120}
                      disabled={busy}
                      spellCheck={false}
                      placeholder={profile.id === 'hive' ? 'Hive 서비스의 모델 ID' : 'swe-2-high'}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          profiles: draft.profiles.map((p) =>
                            p.id === profile.id ? { ...p, model: e.target.value } : p,
                          ),
                        })
                      }
                    />
                  </label>
                )}
                <p>
                  {profile.id === 'hive'
                    ? 'API 키는 서버 환경변수 HIVE_API_KEY에 보관해요.'
                    : profile.id === 'opencode'
                      ? '서버에 설치한 OpenCode CLI를 사용해요. 모델 목록을 등록해도 설치·인증·실행이 자동으로 켜지지는 않아요.'
                      : '서버에 설치하고 로그인한 CLI를 사용해요. 실행이 끝나면 임시 기록을 지우고, 앱의 요청·결과는 남겨요.'}
                </p>
                {profile.id === 'opencode' && (
                  <p>
                    <a
                      href="https://opencode.ai/docs/zen/#privacy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      모델별 데이터 이용 조건
                    </a>{' '}
                    ·{' '}
                    <a
                      href="https://opencode.ai/legal/terms-of-service"
                      target="_blank"
                      rel="noreferrer"
                    >
                      서비스 약관
                    </a>
                  </p>
                )}
              </div>
            ))}
          <p className="settings-save-note">
            ‘설정됨’은 키·실행 파일의 설정 여부예요. 실제 응답 가능 여부는 요청할 때 확인해요.
            실패해도 다른 실행기로 자동 전환하지 않아요.
          </p>
          <div className="settings-ai-actions">
            <button disabled={busy || catalogBusy} onClick={() => void save()}>
              {busy ? '저장 중…' : 'AI 설정 저장'}
            </button>
            <button
              disabled={busy || catalogBusy}
              onClick={() => {
                setDraft(null);
                reload();
                setError('');
              }}
            >
              최신 설정 불러오기
            </button>
          </div>
          {notice && <p role="status">{notice}</p>}
        </>
      )}
      {error && (
        <p className="settings-ai-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
