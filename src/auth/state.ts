export type AuthSnapshot = {
  state: 'loading' | 'disabled' | 'authenticated' | 'required' | 'unconfigured' | 'offline';
  locked: boolean;
};
const lockKey = 'leneu:auth-locked';
function savedLock() {
  try {
    return localStorage.getItem(lockKey) === 'true';
  } catch {
    return false;
  }
}
function saveLock(locked: boolean) {
  try {
    if (locked) localStorage.setItem(lockKey, 'true');
    else localStorage.removeItem(lockKey);
  } catch {
    /* Memory state still protects this tab when storage is unavailable. */
  }
}
let snapshot: AuthSnapshot = { state: 'loading', locked: savedLock() };
let generation = 0;
const listeners = new Set<() => void>();
export const getAuthSnapshot = () => snapshot;
export function subscribeAuth(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function publish(update: Partial<AuthSnapshot>) {
  snapshot = { ...snapshot, ...update };
  listeners.forEach((fn) => fn());
}
export function authenticationRequired() {
  generation++;
  if (snapshot.state !== 'disabled') publish({ state: 'required' });
}
export function lockWorkspace() {
  generation++;
  saveLock(true);
  publish({ state: 'required', locked: true });
}
export async function authRequest(path: string, body?: Record<string, unknown>) {
  const response = await fetch('/api/auth/' + path, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401) authenticationRequired();
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw Error('로그인 서버 연결을 확인해 주세요.');
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(Error(data.error || '로그인을 확인하지 못했어요.'), {
      code: data.code,
      status: response.status,
    });
  return data;
}
export async function refreshAuth({ unlock = false }: { unlock?: boolean } = {}) {
  const requestGeneration = ++generation;
  try {
    const value = await authRequest('status');
    if (requestGeneration !== generation) return;
    const authenticated = value.authenticated && (!snapshot.locked || unlock);
    if (authenticated || !value.enabled) saveLock(false);
    publish({
      state: !value.enabled
        ? 'disabled'
        : !value.configured
          ? 'unconfigured'
          : authenticated
            ? 'authenticated'
            : 'required',
      ...(authenticated || !value.enabled ? { locked: false } : {}),
    });
  } catch {
    if (requestGeneration === generation) publish({ state: 'offline' });
  }
}
let channel: BroadcastChannel | undefined;
export function watchAuthTabs() {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  channel ??= new BroadcastChannel('leneu-auth-v1');
  const receive = (event: MessageEvent) => {
    if (event.data === 'logout') lockWorkspace();
    void refreshAuth({ unlock: event.data === 'login' });
  };
  channel.addEventListener('message', receive);
  return () => channel?.removeEventListener('message', receive);
}
export async function loggedIn() {
  generation++;
  saveLock(false);
  publish({ state: 'authenticated', locked: false });
  channel?.postMessage('login');
  // Resume in the background; opening the workspace must not wait for a large outbox.
  void import('../sync/runtime')
    .then(({ requestWorkspaceSync }) => requestWorkspaceSync())
    .catch(() => {});
}
export function loggedOut() {
  lockWorkspace();
  channel?.postMessage('logout');
}
