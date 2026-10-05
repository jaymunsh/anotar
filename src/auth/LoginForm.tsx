import { useState } from 'react';
import { LockKeyhole, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { authRequest, loggedIn } from './state';
export default function LoginForm({ onDone }: { onDone?: () => void }) {
  const [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [remember, setRemember] = useState(false);
  const [recovery, setRecovery] = useState(false),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="auth-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await authRequest('login', {
            password,
            code: code.trim(),
            remember: !recovery && remember,
            deviceName: /Android|iPhone|iPad/.test(navigator.userAgent)
              ? '내 휴대폰'
              : '내 브라우저',
          });
          setPassword('');
          setCode('');
          await loggedIn();
          onDone?.();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '다시 시도해 주세요.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="auth-heading">
        <LockKeyhole size={20} aria-hidden />
        <h1>나의 공간에 로그인</h1>
      </div>
      <p className="auth-description">기록을 이어가려면 본인 인증을 해주세요.</p>
      <label htmlFor="auth-password">비밀번호</label>
      <div className="auth-password-field">
        <input
          id="auth-password"
          type={visible ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          maxLength={1024}
          autoFocus
          disabled={busy}
        />
        <button
          type="button"
          aria-label={visible ? '비밀번호 숨기기' : '비밀번호 표시'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      <label htmlFor="auth-code">{recovery ? '복구 코드' : '인증 코드'}</label>
      <input
        id="auth-code"
        className="auth-code"
        type="text"
        inputMode={recovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        placeholder={recovery ? '저장해 둔 일회용 복구 코드' : '6자리 코드'}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
        maxLength={recovery ? 24 : 6}
        disabled={busy}
        aria-describedby="auth-code-help"
      />
      <p id="auth-code-help" className="auth-help">
        {recovery
          ? '복구 코드는 한 번만 사용할 수 있어요.'
          : 'Google Authenticator에 표시된 코드를 입력해 주세요.'}
      </p>
      {!recovery && (
        <label className="auth-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={busy}
          />
          이 브라우저를 30일 동안 기억하기
        </label>
      )}
      {!recovery && (
        <p className="auth-help">
          개인 기기에서만 선택해 주세요. 7일간 사용하지 않으면 다시 인증해요.
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button className="auth-primary" type="submit" disabled={busy}>
        {busy ? '확인 중…' : '로그인'}
        <ArrowRight size={17} aria-hidden />
      </button>
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
        {recovery ? 'Authenticator 코드 사용' : '복구 코드 사용'}
      </button>
    </form>
  );
}
