import type { PageDocument } from '../src/pages/types';
import type { JournalDay } from './journal.mjs';
export type SyncEntityKind = 'capture' | 'task' | 'page' | 'journal';
export type SyncChange = {
  seq: number;
  entityKind: SyncEntityKind;
  entityId: string;
  action: 'upsert' | 'tombstone';
};
export type SyncSession = {
  protocolVersion: 1;
  workspaceId: string;
  epoch: string;
  headSeq: number;
  capabilities: SyncOperation['kind'][];
  serverTime: string;
};
type Created = { clientCreatedAt?: string };
type Payloads = {
  'journal.create': Created & { date: string; day: JournalDay };
  'journal.update': { date: string; day: JournalDay };
  'capture.create': Created & {
    kind: 'note' | 'link' | 'image' | 'file';
    text: string;
    url: string | null;
    uploadIds: string[];
    aiRequest: null;
  };
  'capture.update': { text: string; url: string | null };
  'task.create': Created & { title: string; dueDate: string | null; pageId?: string | null };
  'task.update': { title: string; dueDate: string | null; stage: 'todo' | 'doing' | 'done'; pageId?: string | null };
  'page.create': Created & {
    title: string;
    icon: string;
    parentId: string | null;
    document: PageDocument;
  };
  'page.update': { title: string; icon: string; document: PageDocument };
  'capture.organize': {
    requestId: string;
    sourceOperationId?: string;
    sourceSnapshot: Record<string, unknown>;
    target: Record<string, unknown>;
    copyContent: boolean;
    assetIds: string[];
    aiResult?: Record<string, unknown>;
  };
  'ai.submit': {
    requestId: string;
    sourceKind: 'capture' | 'page';
    sourceOperationId?: string;
    sourceSnapshot: Record<string, unknown>;
    request: Record<string, unknown>;
    blockIds?: string[];
    retryOf?: string | null;
  };
};
export type SyncOperation = {
  [K in keyof Payloads]: {
    protocolVersion: 1;
    workspaceId: string;
    epoch: string;
    operationId: string;
    deviceId: string;
    kind: K;
    entityId: string;
    baseVersion: number | null;
    baseOperationId?: string;
    payload: Payloads[K];
  };
}[keyof Payloads];
export type SyncApplyResult = {
  status: 'applied';
  operationId: string;
  replayed: boolean;
  item: Record<string, unknown>;
  version: number;
  workflow?: { kind: 'capture.organize' | 'ai.submit'; item: Record<string, unknown>; blockIds?: string[] };
};
export type SyncConflict = {
  status: 'conflict';
  operationId: string;
  current: Record<string, unknown> | null;
  tombstone: boolean;
  code: string;
};
export type SyncEntity = {
  workspaceId?: string;
  epoch?: string;
  entityKind: SyncEntityKind;
  entityId: string;
  item: Record<string, unknown> | null;
  version: number | null;
  readSeq: number;
  tombstone: boolean;
  missing: boolean;
};
