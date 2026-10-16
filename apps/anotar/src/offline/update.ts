import { registerCaptureReceiver } from '../capture/registration';
export async function prepareOfflineShell(): Promise<{ ready: boolean; appVersion: string }> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext)
    return { ready: false, appVersion: '' };
  const error = await registerCaptureReceiver();
  if (error) return { ready: false, appVersion: '' };
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => {
      readinessTimer = setTimeout(() => resolve(null), 30000);
    }),
  ]);
  clearTimeout(readinessTimer);
  if (!registration) return { ready: false, appVersion: '' };
  const worker = registration.active;
  if (!worker) return { ready: false, appVersion: '' };
  return new Promise((resolve) => {
    const channel = new MessageChannel(),
      timer = setTimeout(() => resolve({ ready: false, appVersion: '' }), 10000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage({ type: 'SHELL_STATUS' }, [channel.port2]);
  });
}
const flushers = new Set<() => Promise<void>>();
export function registerLocalFlush(flush: () => Promise<void>) {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}
export async function flushLocalEdits() {
  for (const flush of flushers) await flush();
}
export async function activatePreparedUpdate() {
  await flushLocalEdits();
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration?.waiting) return false;
  const worker = registration.waiting;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error('업데이트를 준비하지 못했어요. 자료는 기기에 남아 있어요.')),
      15000,
    );
    const changed = () => {
      if (worker.state === 'activated') {
        clearTimeout(timer);
        worker.removeEventListener('statechange', changed);
        resolve();
      }
    };
    worker.addEventListener('statechange', changed);
    worker.postMessage({ type: 'ACTIVATE_SHELL' });
    changed();
  });
  location.reload();
  return true;
}
