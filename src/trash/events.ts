const eventName = 'leneu:records-changed';

export function publishRecordChange(source: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: source }));
  try {
    localStorage.setItem(eventName, crypto.randomUUID());
  } catch {
    /* Local refresh still works. */
  }
}

export function subscribeRecordChanges(listener: (source: string) => void) {
  const onChange = (event: Event) => listener((event as CustomEvent<string>).detail);
  const onFocus = () => listener('focus');
  const onStorage = (event: StorageEvent) => {
    if (event.key === eventName) listener('external');
  };
  window.addEventListener(eventName, onChange);
  window.addEventListener('focus', onFocus);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(eventName, onChange);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('storage', onStorage);
  };
}
