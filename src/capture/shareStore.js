// Shared by the private app and its narrowly scoped share receiver. Never caches API responses.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_QUEUE_BYTES = 200 * 1024 * 1024;
const MAX_PENDING = 16;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv']);
const EXTENSIONS = /\.(png|jpe?g|webp|gif|heic|heif|avif|pdf|txt|md|csv)$/i;
const DANGEROUS_EXTENSIONS = /\.(html?|svg|xml|js|mjs|exe|sh|bat)$/i;

export function inferCaptureUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.hostname && !url.username && !url.password ? text : null;
  } catch { return null; }
}

export function validateShare(value) {
  const read = (key, limit) => {
    if (value[key] == null) return '';
    if (typeof value[key] !== 'string') throw new Error('공유 내용은 문자여야 해요.');
    if (value[key].length > limit) throw new Error('공유 글은 10,000자, 제목은 1,000자, 주소는 8,192자까지 받을 수 있어요.');
    return value[key].trim();
  };
  const title = read('title', 1000);
  let text = read('text', 10000);
  let url = read('url', 8192);
  if (url && !inferCaptureUrl(url)) throw new Error('HTTP(S) 링크만 가져올 수 있어요. 주소를 확인해 주세요.');
  const inferred = inferCaptureUrl(text) || (!text && inferCaptureUrl(title));
  if (!url && inferred) url = inferred;
  if (text === url) text = '';
  const pieces = [title !== url && title !== text ? title : '', text].filter(Boolean);
  text = pieces.join('\n\n');
  if (text.length > 10000) throw new Error('공유 글은 10,000자까지 받을 수 있어요.');
  if (!Array.isArray(value.files ?? [])) throw new Error('공유 파일 형식을 확인해 주세요.');
  const files = value.files ?? [];
  if (files.length > 8) throw new Error('파일은 8개까지 가져올 수 있어요.');
  let total = 0;
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 240 || /[\/\\\x00-\x1f]/.test(file.name) || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.arrayBuffer !== 'function')
      throw new Error('공유 파일 이름이나 형식을 확인해 주세요.');
    if (file.size > MAX_FILE_BYTES) throw new Error('파일 하나는 25MB까지 가져올 수 있어요.');
    if (DANGEROUS_EXTENSIONS.test(file.name) || !(MIME_TYPES.has(file.type) || ((!file.type || file.type === 'application/octet-stream') && EXTENSIONS.test(file.name))))
      throw new Error('공유 파일은 이미지, PDF, 텍스트, Markdown, CSV만 가져올 수 있어요. 다른 파일은 앱에서 직접 첨부해 주세요.');
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('공유 파일 전체는 100MB까지 가져올 수 있어요.');
  if (!text && !url && !files.length) throw new Error('가져올 공유 내용이 없어요. 원본 앱에서 다시 공유해 주세요.');
  return { text, url, files };
}

export function mergeReviewedShare(draft, share) {
  if (draft.input.shareImportIds?.includes(share.id)) return draft;
  if (draft.input.aiEnabled) throw new Error('AI 요청을 끈 뒤 공유 내용을 가져와 주세요.');
  const incoming = validateShare({ text: share.text, url: share.url, files: share.files });
  const files = [...draft.files, ...incoming.files];
  if (files.length > 8) throw new Error('기존 첨부와 합쳐 파일은 8개까지 보관할 수 있어요.');
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error('기존 첨부와 합쳐 전체 100MB까지 보관할 수 있어요.');
  const occupied = Boolean(draft.input.text || draft.input.url || draft.files.length || draft.input.aiAdditional);
  const acceptsUrlField = !occupied || draft.input.kind === 'link';
  const url = acceptsUrlField ? draft.input.url || incoming.url : draft.input.url;
  const body = [draft.input.text, incoming.text].filter(Boolean).join('\n\n');
  const appendUrl = incoming.url && (!acceptsUrlField || (draft.input.url && draft.input.url !== incoming.url)) && !body.includes(incoming.url);
  const text = [body, appendUrl ? incoming.url : ''].filter(Boolean).join('\n\n');
  if (text.length > 10000) throw new Error('기존 초안과 합친 글은 10,000자까지 가져올 수 있어요.');
  const kind = occupied ? draft.input.kind : url ? 'link' : files.length ? files.every((file) => file.type.startsWith('image/')) ? 'image' : 'file' : 'note';
  return { input: { ...draft.input, kind, text, url, shareImportIds: [...(draft.input.shareImportIds ?? []), share.id] }, files };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open('leneu-capture-imports-v1', 1); }
    catch { reject(new Error('공유 대기함을 열지 못했어요. 브라우저 저장 공간을 확인해 주세요.')); return; }
    request.onupgradeneeded = () => request.result.createObjectStore('imports', { keyPath: 'id' });
    request.onerror = () => reject(new Error('공유 대기함을 열지 못했어요. 브라우저 저장 공간을 확인해 주세요.'));
    request.onblocked = () => reject(new Error('다른 창을 닫고 공유 대기함을 다시 열어 주세요.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function transaction(mode, run) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('imports', mode);
      let result;
      const setResult = (value) => { result = value; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('공유 대기함에 보관하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'));
      tx.onerror = () => reject(tx.error || new Error('공유 대기함에 보관하지 못했어요.'));
      run(tx.objectStore('imports'), setResult, tx);
    });
  } finally { db.close(); }
}

export async function putPendingShare(value, id = crypto.randomUUID()) {
  const share = validateShare(value);
  const record = { ...share, id, createdAt: Date.now(), state: 'pending' };
  let problem = '';
  await transaction('readwrite', (store, done, tx) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const records = request.result;
      if (records.some((entry) => entry.id === id)) return done(id);
      const pending = records.filter((entry) => entry.state === 'pending');
      const bytes = pending.reduce((sum, entry) => sum + entry.files.reduce((n, file) => n + file.size, 0), 0) + share.files.reduce((sum, file) => sum + file.size, 0);
      if (pending.length >= MAX_PENDING || bytes > MAX_QUEUE_BYTES) {
        problem = '공유 대기함이 가득 찼어요. 대기 중인 내용을 가져오거나 지운 뒤 다시 공유해 주세요.';
        tx.abort();
        return;
      }
      store.add(record);
      done(id);
    };
  }).catch((error) => { throw new Error(problem || error.message); });
  return id;
}

export async function listPendingShares() {
  return transaction('readonly', (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done(request.result.filter((entry) => entry.state === 'pending').sort((a, b) => a.createdAt - b.createdAt));
  });
}

export async function finishPendingShare(id) {
  return transaction('readwrite', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result || request.result.state === 'consumed') return done(false);
      // Keep a bounded tombstone for retransmission, but release personal content and file bytes.
      store.put({ id, createdAt: request.result.createdAt, state: 'consumed', text: '', url: '', files: [] });
      const all = store.getAll();
      all.onsuccess = () => all.result.filter((entry) => entry.state === 'consumed').sort((a, b) => b.createdAt - a.createdAt).slice(128).forEach((entry) => store.delete(entry.id));
      done(true);
    };
  });
}
