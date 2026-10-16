import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { getAuthSnapshot, subscribeAuth, refreshAuth, watchAuthTabs } from './state';
import { readRecord } from '../sync/repository';
import LoginForm from './LoginForm';
import './auth.css';
function LoginDialog({ close }: { close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog className="auth-dialog" ref={ref} onClose={close} aria-label="다시 로그인">
      <button
        className="auth-dialog-close"
        type="button"
        aria-label="로그인 창 닫기"
        onClick={close}
      >
        <X size={18} />
      </button>
      <LoginForm onDone={close} />
      <p className="auth-local-note">작성 중인 글과 전송 대기 자료는 그대로 유지돼요.</p>
    </dialog>
  );
}
export default function AuthBoundary({ children }: { children: ReactNode }) {
  const auth = useSyncExternalStore(subscribeAuth, getAuthSnapshot),
    [binding, setBinding] = useState<boolean>(),
    [started, setStarted] = useState(false),
    [login, setLogin] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!auth.locked) return;
    // Native modal top layers stay active when an ancestor is hidden. Close them,
    // preserving the mounted editors, so the login screen can receive input.
    workspaceRef.current
      ?.querySelectorAll<HTMLDialogElement>('dialog[open]')
      .forEach((dialog) => dialog.close());
    setLogin(false);
    document.querySelector<HTMLInputElement>('.auth-screen input')?.focus();
  }, [auth.locked]);
  useEffect(() => {
    let alive = true;
    void readRecord<{ boundWorkspaceId?: string }>('meta', '@device', 'binding')
      .then((value) => {
        if (alive) setBinding(Boolean(value?.boundWorkspaceId));
      })
      .catch(() => {
        if (alive) setBinding(false);
      });
    void refreshAuth();
    const off = watchAuthTabs();
    const online = () => {
      void refreshAuth();
    };
    window.addEventListener('online', online);
    // First login lives outside App, so initialize its theme before the workspace mounts.
    let theme: string | null = null;
    try {
      theme = localStorage.getItem('leneu:theme');
    } catch {
      /* Keep system appearance when storage is unavailable. */
    }
    document.documentElement.dataset.theme =
      theme === 'light' || theme === 'dark'
        ? theme
        : matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    return () => {
      alive = false;
      off();
      window.removeEventListener('online', online);
    };
  }, []);
  const canStart =
    auth.state === 'disabled' ||
    auth.state === 'authenticated' ||
    (binding === true && !auth.locked);
  useEffect(() => {
    if (canStart) setStarted(true);
  }, [canStart]);
  const ready = started || canStart,
    hidden = auth.locked;
  return (
    <>
      {ready && (
        <div ref={workspaceRef} hidden={hidden} inert={hidden}>
          {children}
        </div>
      )}
      {(!ready || hidden) && (
        <main className="auth-screen">
          <a className="auth-brand" href="/" aria-label="anotar 홈">
            <img src="/capture-icons/icon-192.png" alt="" width="30" height="30" />
            <span>anotar</span>
          </a>
          {auth.state === 'loading' || binding === undefined ? (
            <p role="status">나의 공간을 확인하는 중…</p>
          ) : auth.state === 'required' || auth.state === 'authenticated' ? (
            <LoginForm />
          ) : (
            <section className="auth-preparing">
              <h1>
                {auth.state === 'unconfigured' ? '접속 준비 중' : '서버 연결을 기다리고 있어요'}
              </h1>
              <p>
                {auth.state === 'unconfigured'
                  ? '개인 계정 설정이 아직 끝나지 않았어요.'
                  : '처음 접속할 때는 인터넷 연결과 로그인이 필요해요.'}
              </p>
              <button className="auth-primary" onClick={() => void refreshAuth()}>
                다시 확인
              </button>
            </section>
          )}
          <p className="auth-local-note">
            개인 작업 공간 · 이 기기의 미전송 기록은 삭제하지 않아요.
          </p>
        </main>
      )}
      {ready && !hidden && auth.state === 'required' && (
        <div className="auth-expiry" role="status">
          <span>로그인이 필요해요. 글은 기기에 저장되고 전송은 대기해요.</span>
          <button type="button" onClick={() => setLogin(true)}>
            로그인
          </button>
        </div>
      )}
      {login && <LoginDialog close={() => setLogin(false)} />}
    </>
  );
}
