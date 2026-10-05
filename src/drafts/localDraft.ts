type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const SESSION_KEY = 'leneu:draft-session:v1';

export function draftSessionId(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const existing = storage.getItem(SESSION_KEY);
  if (existing && /^[a-f0-9-]{36}$/.test(existing)) return existing;
  const id = crypto.randomUUID();
  storage.setItem(SESSION_KEY, id);
  return id;
}

let sessionId: string | undefined;
export function browserDraftSession() {
  if (!sessionId) {
    try {
      sessionId = draftSessionId(window.sessionStorage);
    } catch {
      sessionId = crypto.randomUUID();
    }
  }
  return sessionId;
}

export function loadDraft<T>(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  isValue: (value: unknown) => value is T,
): T | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const envelope = JSON.parse(raw);
    if (envelope.schemaVersion !== 1 || !isValue(envelope.value)) throw new Error();
    return envelope.value;
  } catch {
    throw new Error('임시저장된 초안을 복구하지 못했어요. 기존 저장값은 그대로 두었어요.');
  }
}

export function saveDraft(storage: DraftStorage, key: string, value: unknown | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ schemaVersion: 1, value }));
  } catch {
    throw new Error(
      '초안을 임시저장하지 못했어요. 새로고침하기 전에 보관하거나 내용을 복사해 주세요.',
    );
  }
}
