import { useEffect, useState, useSyncExternalStore } from 'react';
import { Monitor, Smartphone, LogOut } from 'lucide-react';
import { authRequest, getAuthSnapshot, subscribeAuth, loggedOut } from './state';
type Device = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  remembered: boolean;
  current: boolean;
};
const date = (value: number) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
export default function SecuritySettings() {
  const auth = useSyncExternalStore(subscribeAuth, getAuthSnapshot),
    [devices, setDevices] = useState<Device[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState(''),
    [recovery, setRecovery] = useState(false),
    [remaining, setRemaining] = useState<number>(),
    [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      const data = await authRequest('devices');
      setDevices(data.items);
      setRemaining(data.recoveryCodesRemaining);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '기기를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (auth.state === 'authenticated') void load();
    else setLoading(false);
  }, [auth.state]);
  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      if (id === 'all' || !devices.find((d) => d.id === id)?.current) {
        await authRequest('reauth', { code: code.trim() });
        setCode('');
      }
      const result = await authRequest('revoke', { id });
      if (!result.authenticated) loggedOut();
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그아웃하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="security-settings" aria-labelledby="security-title">
      <h3 id="security-title">보안</h3>
      <p className="settings-description">로그인한 브라우저와 접근 권한을 관리해요.</p>
      {auth.state === 'disabled' ? (
        <p>현재는 로컬 개발 모드예요. 서버 공개 전에 개인 계정을 설정해 주세요.</p>
      ) : (
        <>
          <div className="security-summary">
            <strong>비밀번호 + Authenticator</strong>
            <p>신뢰한 브라우저는 최대 30일, 미사용 7일 후 다시 인증해요.</p>
            {remaining !== undefined && (
              <small>사용 가능한 복구 코드 {remaining}개 · 별도로 보관해 주세요.</small>
            )}
          </div>
          <h4>로그인한 브라우저</h4>
          {loading ? (
            <p role="status">기기를 확인하는 중…</p>
          ) : (
            <ul className="security-devices">
              {devices.map((d) => (
                <li key={d.id}>
                  <div className="security-device-icon">
                    {/휴대폰/.test(d.name) ? <Smartphone size={18} /> : <Monitor size={18} />}
                  </div>
                  <div className="security-device-info">
                    <strong>{d.name}</strong>
                    {d.current && <span className="security-current">현재 브라우저</span>}
                    <p>최근 사용 {date(d.lastUsedAt)}</p>
                    <small>
                      {d.remembered ? '기억한 기기' : '이번 로그인'} · 만료 {date(d.expiresAt)}
                    </small>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(d.id)}
                    aria-label={d.current ? '이 브라우저 로그아웃' : `${d.name} 로그아웃`}
                  >
                    로그아웃
                  </button>
                </li>
              ))}
            </ul>
          )}
          {devices.length > 0 && (
            <div className="security-reauth">
              <label htmlFor="security-code">
                {recovery ? '로그아웃 확인용 복구 코드' : '로그아웃 확인용 인증 코드'}
              </label>
              <input
                id="security-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode={recovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                placeholder={recovery ? '저장한 일회용 복구 코드' : '새 6자리 인증 코드'}
                maxLength={recovery ? 24 : 6}
                disabled={busy}
              />
              <p className="auth-help">
                다른 브라우저·전체 로그아웃을 확인할 때 사용해요.
                {recovery ? ' 복구 코드는 한 번만 사용할 수 있어요.' : ''}
              </p>
              <button
                className="auth-text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setRecovery((v) => !v);
                  setCode('');
                  setError('');
                }}
              >
                {recovery ? 'Authenticator 코드로 확인' : '복구 코드로 확인'}
              </button>
            </div>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="auth-text-button security-all"
            type="button"
            disabled={busy || !devices.length}
            onClick={() => void revoke('all')}
          >
            <LogOut size={16} />
            모든 브라우저 로그아웃
          </button>
          <p className="auth-local-note">
            로그아웃은 서버 접근을 끊어요. 이미 기기에 저장한 글은 삭제하지 않으며, 작성 중인 초안도
            남겨요.
          </p>
        </>
      )}
    </section>
  );
}
