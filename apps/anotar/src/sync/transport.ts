import type {
  SyncApplyResult,
  SyncEntity,
  SyncEntityKind,
  SyncOperation,
  SyncSession,
  SyncChange,
} from '../../shared/sync.ts';
import { authenticationRequired } from '../auth/state.ts';
export class TransportError extends Error {
  status: number;
  code: string;
  current: Record<string, unknown> | null | undefined;
  tombstone: boolean;
  retryAfter?: number;
  constructor(
    status: number,
    message: string,
    body: Record<string, unknown> = {},
    retryAfter?: number,
  ) {
    super(message);
    this.status = status;
    this.code = String(body.code ?? 'network');
    this.current = body.current as typeof this.current;
    this.tombstone = Boolean(body.tombstone);
    this.retryAfter = retryAfter;
  }
}
async function json<T>(path: string, init: RequestInit = {}, timeout = 15000): Promise<T> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch('/api/sync/' + path, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (response.status === 401) authenticationRequired();
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new TransportError(
        response.ok ? 502 : response.status,
        '서버 연결을 확인해 주세요. 올바른 응답이 아니에요.',
      );
    let body: Record<string, unknown>;
    try {
      body = await response.json();
    } catch {
      throw new TransportError(502, '서버 응답을 읽지 못했어요.');
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after'),
        seconds = Number(retry),
        retryAfter = retry
          ? Number.isFinite(seconds)
            ? seconds * 1000
            : Math.max(0, Date.parse(retry) - Date.now())
          : undefined;
      throw new TransportError(
        response.status,
        String(body.error ?? '동기화하지 못했어요.'),
        body,
        retryAfter,
      );
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}
export type SyncTransport = {
  session: () => Promise<SyncSession>;
  bootstrap: (
    kind: SyncEntityKind,
    afterId: string | null,
  ) => Promise<{
    workspaceId?: string;
    epoch?: string;
    items: Record<string, unknown>[];
    nextAfterId: string | null;
  }>;
  pullChanges: (
    after: number,
  ) => Promise<{ epoch: string; headSeq: number; nextAfter: number; changes: SyncChange[] }>;
  fetchEntity: (kind: SyncEntityKind, id: string) => Promise<SyncEntity>;
  fetchMetadata?: (kind: SyncEntityKind, id: string) => Promise<SyncEntity>;
  applyOperation: (operation: SyncOperation) => Promise<SyncApplyResult>;
  upload?: (blob: Blob, metadata: Record<string, string>) => Promise<unknown>;
};
export const transport: SyncTransport = {
  session: () => json('session'),
  bootstrap: (kind, afterId) =>
    json(`bootstrap?kind=${kind}&afterId=${encodeURIComponent(afterId ?? '')}&limit=100`),
  pullChanges: (after) => json(`changes?after=${after}&limit=100`),
  fetchEntity: (kind, id) => json(`entities/${kind}/${encodeURIComponent(id)}`),
  fetchMetadata: (kind, id) => json(`entities/${kind}/${encodeURIComponent(id)}?metadata=1`),
  applyOperation: (operation) =>
    json('operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation),
    }),
  upload: (blob, metadata) =>
    json(
      `uploads/${metadata.uploadId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': metadata.mime,
          'X-Leneu-Operation-Id': metadata.operationId,
          'X-Leneu-Content-SHA256': metadata.hash,
          'X-Leneu-File-Name': encodeURIComponent(metadata.name),
        },
        body: blob,
      },
      60000,
    ),
};
