import type { StoredAiRequest } from '../../shared/aiRequests.ts';
export type AiStatus = 'queued' | 'running' | 'result_ready' | 'failed';
export type AiJobSummary = {
  id: string;
  status: AiStatus;
  sourceVersion: number;
  errorCode: string | null;
  updatedAt: string;
};
export type AiRunner = { label: string; mode: 'test' | 'live' };
export type AiActivityFilter = 'all' | 'active' | 'result_ready' | 'failed';
export type AiActivityItem = {
  id: string;
  captureId: string | null;
  pageId: string | null;
  ownerKind: 'memo' | 'page';
  href: string;
  sourceTitle: string;
  preview: string;
  templateName: string;
  executionLabel?: string;
  model?: string;
  templateVersion?: number | null;
  organized: boolean;
  status: AiStatus;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
export type AiActivity = {
  items: AiActivityItem[];
  counts: Record<AiStatus, number>;
  total: number;
};
export type AiJob = AiJobSummary & {
  captureId: string | null;
  pageId: string | null;
  targetBlockIds: string[];
  sourceDocument?: import('../pages/types').PageDocument;
  sourceTitle?: string;
  requestId: string;
  request: StoredAiRequest;
  retryOf: string | null;
  runner: AiRunner | null;
  result: {
    markdown: string;
    sources: { url: string; title: string; verified: boolean; fetchedAt: string | null }[];
    usage: { inputTokens: number | null; outputTokens: number | null } | null;
  } | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stale: boolean;
};
export const activeAiJob = (job: AiJobSummary | null | undefined) =>
  job?.status === 'queued' || job?.status === 'running';
export function aiStatusLabel(job: Pick<AiJobSummary, 'status' | 'errorCode'> | null | undefined) {
  if (!job) return '요청 준비됨';
  if (job.status === 'failed' && job.errorCode === 'runner_unavailable') return '연결 필요';
  return {
    queued: '대기 중',
    running: '처리 중',
    result_ready: '결과 준비됨',
    failed: '처리 실패',
  }[job.status];
}
