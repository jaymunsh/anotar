import { useEffect, useState } from 'react';
import type { PageRecord } from './types';

// 온라인 전용 페이지 로더. 서버 GET으로 현재 문서를 읽는다.
// 예전 기기 우선 IndexedDB entity/conflict 대신 서버 응답을 그대로 쓴다.
export type LocalPageRecord = {
  current: PageRecord;
  localRevision: number;
  dirty: false;
  base: PageRecord;
};

export function useLocalPage(pageId: string) {
  const [record, setRecord] = useState<LocalPageRecord>();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch('/api/pages/' + pageId, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const item = (await response.json()).item as PageRecord;
        if (active) setRecord({ current: item, localRevision: 0, dirty: false, base: item });
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [pageId]);
  // 충돌은 저장 시점(409)에서 처리하므로 여기서는 항상 없음이다.
  return { record, conflict: undefined as undefined };
}

export class PageSaveConflictError extends Error {
  current: PageRecord | null;
  constructor(message: string, current: PageRecord | null) {
    super(message);
    this.name = 'PageSaveConflictError';
    this.current = current;
  }
}

// 서버에 페이지를 저장한다. 성공 = 서버 응답 성공.
export async function persistLocalPage(
  pageId: string,
  changes: Pick<PageRecord, 'title' | 'icon' | 'document'>,
  base: PageRecord,
): Promise<PageRecord> {
  const title = changes.title.trim() || '제목 없음';
  if (new TextEncoder().encode(JSON.stringify(changes.document)).length > 1024 * 1024)
    throw new Error('페이지 본문은 1MB까지 저장할 수 있어요.');
  let response: Response;
  try {
    response = await fetch('/api/pages/' + pageId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        icon: changes.icon ?? '',
        document: changes.document,
        expectedVersion: base.version,
      }),
    });
  } catch {
    throw new Error('저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  }
  if (response.status === 409) {
    const data = await response.json().catch(() => ({}));
    throw new PageSaveConflictError(
      data.error || '다른 곳에서 바뀌었어요.',
      (data.current as PageRecord) ?? null,
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '저장하지 못했어요.');
  }
  return (await response.json()).item as PageRecord;
}
