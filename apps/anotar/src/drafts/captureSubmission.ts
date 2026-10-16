import type { AiRequestSelection, AiExecution } from '../../shared/aiRequests.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type Input = {
  kind: string;
  text: string;
  url: string;
  aiEnabled: boolean;
  aiTemplateId: string;
  aiAdditional: string;
  aiExecution?: AiExecution | null;
};
type Receipt = { requestId: string; hash: string; selection: AiRequestSelection | null };
const digest = async (bytes: BufferSource) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

export async function prepareCaptureSubmission({
  storage,
  key,
  input,
  files,
  selection,
}: {
  storage: StorageLike;
  key: string;
  input: Input;
  files: File[];
  selection: AiRequestSelection | null;
}): Promise<Receipt> {
  const attachments = [];
  for (const file of files)
    attachments.push({
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      sha256: await digest(await file.arrayBuffer()),
    });
  const hash = await digest(new TextEncoder().encode(JSON.stringify({ input, attachments })));
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const previous = JSON.parse(raw) as Receipt;
      if (
        previous.hash === hash &&
        /^[a-f0-9-]{36}$/.test(previous.requestId) &&
        Object.hasOwn(previous, 'selection')
      )
        return previous;
    }
    const receipt = { requestId: crypto.randomUUID(), hash, selection };
    storage.setItem(key, JSON.stringify(receipt));
    return receipt;
  } catch {
    throw new Error(
      '저장 확인 정보를 보관하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.',
    );
  }
}
export function forgetCaptureSubmission(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  key: string,
  requestId: string,
) {
  try {
    if (JSON.parse(storage.getItem(key) || 'null')?.requestId === requestId)
      storage.removeItem(key);
  } catch {
    /* Keep an ambiguous receipt for the next attempt. */
  }
}
