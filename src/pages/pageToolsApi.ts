import { onlineActionFetch } from '../sync/onlineActions.ts';
import type { PageDocument, PageRecord } from './types';
import { staticMapStyles } from '../../shared/staticMap.ts';

export type PageTemplate = {
  id: string;
  name: string;
  title: string;
  icon: string;
  document: PageDocument;
  createdAt: string;
};
export type PageRevisionSummary = {
  pageId: string;
  version: number;
  title: string;
  icon: string;
  createdAt: string;
};
export type PageRevision = PageRevisionSummary & { document: PageDocument };
export type PageToolsKind =
  'duplicate' | 'save-template' | 'create-template-page' | 'move' | 'restore' | 'assets' | 'map-image';
type FileSnapshot = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  sha256: string;
};
export type PageToolsPending = {
  kind: PageToolsKind;
  pageId: string;
  path: string;
  body: Record<string, unknown> & { operationId: string };
  files?: FileSnapshot[];
};
export type PageToolsReceipt<T = PageRecord> = { item: T; target?: PageRecord; replayed?: boolean };
const retainedFiles = new Map<string, File[]>();
const storageKey = (id: string) => `leneu:page-tools-submit:v1:${id}`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const version = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const resourceId = (value: unknown): value is string =>
  typeof value === 'string' && uuid.test(value);
const unresolved = '저장 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.';

export class PageToolsResponseError extends Error {
  definitive: boolean;
  constructor(message: string, definitive: boolean) {
    super(message);
    this.name = 'PageToolsResponseError';
    this.definitive = definitive;
  }
}
export class PageToolsFilesMissingError extends PageToolsResponseError {
  constructor() {
    super(
      '첨부 원본을 다시 선택해 주세요. 처음 선택한 파일과 같은지 확인한 뒤 같은 요청을 보냅니다.',
      false,
    );
    this.name = 'PageToolsFilesMissingError';
  }
}

function pathFor(kind: PageToolsKind, pageId: string, body: Record<string, unknown>) {
  const prefix = '/api/pages/' + encodeURIComponent(pageId);
  if (kind === 'save-template') return '/api/page-templates';
  if (kind === 'create-template-page')
    return '/api/page-templates/' + encodeURIComponent(String(body.templateId)) + '/pages';
  if (kind === 'move') return prefix + '/block-moves';
  if (kind === 'restore') return prefix + '/revisions/' + body.revisionVersion + '/restore';
  if (kind === 'map-image') return prefix + '/map-images';
  return prefix + '/' + (kind === 'assets' ? 'assets' : 'duplicate');
}
function validPending(value: PageToolsPending, pageId: string) {
  if (
    !value ||
    value.pageId !== pageId ||
    !resourceId(pageId) ||
    !resourceId(value.body?.operationId)
  )
    return false;
  if (
    !['duplicate', 'save-template', 'create-template-page', 'move', 'restore', 'assets', 'map-image'].includes(
      value.kind,
    )
  )
    return false;
  if (value.path !== pathFor(value.kind, pageId, value.body)) return false;
  if (value.kind === 'create-template-page') {
    return (
      resourceId(value.body.templateId) &&
      (value.body.parentId == null || resourceId(value.body.parentId))
    );
  }
  if (!version(value.body.expectedVersion)) return false;
  if (value.kind === 'map-image') return typeof value.body.blockId === 'string' && value.body.blockId.length > 0 && value.body.blockId.length <= 100 && typeof value.body.style === 'string' && Object.hasOwn(staticMapStyles, value.body.style);
  if (value.kind === 'save-template')
    return (
      value.body.pageId === pageId &&
      typeof value.body.name === 'string' &&
      Boolean(value.body.name.trim())
    );
  if (value.kind === 'restore') return version(value.body.revisionVersion);
  if (value.kind === 'move')
    return (
      resourceId(value.body.targetPageId) &&
      value.body.targetPageId !== pageId &&
      version(value.body.targetVersion) &&
      Array.isArray(value.body.blockIds) &&
      value.body.blockIds.length > 0 &&
      value.body.blockIds.every((id) => typeof id === 'string' && id.length > 0)
    );
  if (value.kind === 'assets')
    return (
      Array.isArray(value.files) &&
      value.files.length > 0 &&
      value.files.every(
        (file) =>
          typeof file.name === 'string' &&
          Number.isSafeInteger(file.size) &&
          file.size >= 0 &&
          typeof file.type === 'string' &&
          Number.isSafeInteger(file.lastModified) &&
          /^[a-f0-9]{64}$/.test(file.sha256),
      )
    );
  return true;
}

export function createPageToolsPending(
  kind: PageToolsKind,
  pageId: string,
  body: Record<string, unknown>,
): PageToolsPending {
  const snapshot = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const payload = { ...snapshot, operationId: crypto.randomUUID() };
  return { kind, pageId, path: pathFor(kind, pageId, payload), body: payload };
}
export function createDuplicatePending(page: PageRecord) {
  return createPageToolsPending('duplicate', page.id, { expectedVersion: page.version });
}
export function recoverPageToolsPending(pageId: string): PageToolsPending | null {
  const raw = sessionStorage.getItem(storageKey(pageId));
  if (!raw) return null;
  const value = JSON.parse(raw) as PageToolsPending;
  if (!validPending(value, pageId))
    throw new Error(
      '제출 정보를 읽지 못했어요. 브라우저 저장 정보를 확인한 뒤 페이지를 다시 열어 주세요.',
    );
  return value;
}
export function rememberPageToolsPending(value: PageToolsPending) {
  if (!validPending(value, value.pageId))
    throw new Error('제출 정보를 확인하지 못했어요. 페이지 도구를 다시 열어 주세요.');
  const existing = recoverPageToolsPending(value.pageId);
  if (existing && JSON.stringify(existing) !== JSON.stringify(value))
    throw new Error('먼저 제출한 요청의 저장 여부를 확인해 주세요.');
  sessionStorage.setItem(storageKey(value.pageId), JSON.stringify(value));
}
export function forgetPageToolsPending(pageId: string) {
  const value = recoverPageToolsPending(pageId);
  sessionStorage.removeItem(storageKey(pageId));
  if (value) retainedFiles.delete(value.body.operationId);
}

async function fileSnapshots(files: File[]): Promise<FileSnapshot[]> {
  return Promise.all(
    files.map(async (file) => {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        sha256: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
      };
    }),
  );
}
export async function createPageAssetPending(
  page: PageRecord,
  files: File[],
): Promise<PageToolsPending> {
  if (!files.length) throw new Error('첨부할 파일을 선택해 주세요.');
  const value = createPageToolsPending('assets', page.id, { expectedVersion: page.version });
  value.files = await fileSnapshots(files);
  retainedFiles.set(value.body.operationId, [...files]);
  return value;
}
export async function restorePageAssetFiles(value: PageToolsPending, files: File[]): Promise<void> {
  if (
    value.kind !== 'assets' ||
    JSON.stringify(await fileSnapshots(files)) !== JSON.stringify(value.files)
  )
    throw new Error('처음 선택한 파일과 달라요. 같은 파일을 같은 순서로 선택해 주세요.');
  retainedFiles.set(value.body.operationId, [...files]);
}
export function hasPageAssetFiles(value: PageToolsPending) {
  return value.kind !== 'assets' || retainedFiles.has(value.body.operationId);
}

async function responseData(
  response: Response,
  mutation: boolean,
): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    throw new PageToolsResponseError(
      mutation ? unresolved : '내용을 불러오지 못했어요. 다시 불러와 주세요.',
      false,
    );
  }
  if (!data || typeof data !== 'object')
    throw new PageToolsResponseError(
      mutation ? unresolved : '내용을 불러오지 못했어요. 다시 불러와 주세요.',
      false,
    );
  if (!response.ok)
    throw new PageToolsResponseError(
      typeof data.error === 'string'
        ? data.error
        : mutation
          ? unresolved
          : '내용을 불러오지 못했어요. 다시 불러와 주세요.',
      mutation && [400, 404, 409, 413, 415].includes(response.status),
    );
  return data;
}
export async function readCurrentPage(pageId: string, signal?: AbortSignal): Promise<PageRecord> {
  const data = await responseData(
    await onlineActionFetch('/api/pages/' + encodeURIComponent(pageId), { signal }),
    false,
  );
  const item = data.item as PageRecord | undefined;
  if (
    item?.id !== pageId ||
    !version(item.version) ||
    item.document?.schemaVersion !== 1 ||
    !Array.isArray(item.document.blocks)
  )
    throw new PageToolsResponseError(
      '최신 페이지를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
      false,
    );
  return item;
}
export async function executePageToolsPending<T = PageRecord>(
  value: PageToolsPending,
  { signal }: { signal?: AbortSignal } = {},
): Promise<PageToolsReceipt<T>> {
  rememberPageToolsPending(value);
  const payload = { ...value.body };
  // Routing metadata stays in the browser snapshot; the URL identifies these records.
  delete payload.templateId;
  delete payload.revisionVersion;
  let body: BodyInit;
  let headers: Record<string, string> | undefined;
  if (value.kind === 'assets') {
    const files = retainedFiles.get(value.body.operationId);
    if (!files) throw new PageToolsFilesMissingError();
    const form = new FormData();
    form.set('operationId', value.body.operationId);
    form.set('expectedVersion', String(value.body.expectedVersion));
    for (const file of files) form.append('files', file, file.name);
    body = form;
  } else {
    body = JSON.stringify(payload);
    headers = { 'Content-Type': 'application/json' };
  }
  const data = await responseData(
    await onlineActionFetch(value.path, { method: 'POST', headers, body, signal }),
    true,
  );
  const item = data.item as { id?: string } | undefined;
  if (!item?.id) throw new PageToolsResponseError(unresolved, false);
  if (value.kind === 'save-template') return data as PageToolsReceipt<T>;
  // Even a successful first response may already precede a newer edit in another tab.
  const created = value.kind === 'duplicate' || value.kind === 'create-template-page';
  const currentId = created ? item.id : value.pageId;
  try {
    const current = await readCurrentPage(currentId, signal);
    const target =
      value.kind === 'move'
        ? await readCurrentPage(String(value.body.targetPageId), signal)
        : undefined;
    return { ...data, item: current as T, ...(target ? { target } : {}) } as PageToolsReceipt<T>;
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new PageToolsResponseError(
      '저장 응답은 받았지만 최신 페이지를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
      false,
    );
  }
}

export async function listPageTemplates(signal?: AbortSignal): Promise<PageTemplate[]> {
  const data = await responseData(await onlineActionFetch('/api/page-templates', { signal }), false);
  if (!Array.isArray(data.items))
    throw new Error('템플릿 목록을 불러오지 못했어요. 다시 불러와 주세요.');
  return data.items as PageTemplate[];
}
export async function deletePageTemplate(templateId: string, signal?: AbortSignal): Promise<void> {
  const response = await onlineActionFetch('/api/page-templates/' + encodeURIComponent(templateId), {
    method: 'DELETE',
    signal,
  });
  if (response.status === 404 || response.status === 204) return;
  if (!response.ok) {
    await responseData(response, true);
    return;
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new PageToolsResponseError(
      '삭제 여부를 확인하지 못했어요. 같은 템플릿을 다시 확인해 주세요.',
      false,
    );
  }
  if (typeof data !== 'boolean' && !(data && typeof data === 'object' && 'ok' in data))
    throw new PageToolsResponseError(
      '삭제 여부를 확인하지 못했어요. 같은 템플릿을 다시 확인해 주세요.',
      false,
    );
}
export async function listPageRevisions(
  pageId: string,
  signal?: AbortSignal,
): Promise<PageRevisionSummary[]> {
  const data = await responseData(
    await onlineActionFetch('/api/pages/' + encodeURIComponent(pageId) + '/revisions', { signal }),
    false,
  );
  if (!Array.isArray(data.items))
    throw new Error('수정 이력을 불러오지 못했어요. 다시 불러와 주세요.');
  return data.items as PageRevisionSummary[];
}
export async function readPageRevision(
  pageId: string,
  revisionVersion: number,
  signal?: AbortSignal,
): Promise<PageRevision> {
  const data = await responseData(
    await onlineActionFetch('/api/pages/' + encodeURIComponent(pageId) + '/revisions/' + revisionVersion, {
      signal,
    }),
    false,
  );
  const item = data.item as PageRevision | undefined;
  if (
    !item ||
    item.version !== revisionVersion ||
    item.document?.schemaVersion !== 1 ||
    !Array.isArray(item.document.blocks)
  )
    throw new Error('수정본 내용을 불러오지 못했어요. 다시 불러와 주세요.');
  return item;
}
