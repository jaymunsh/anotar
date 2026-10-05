import type { BackupSettings, BackupStatus } from './types';

export class BackupApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, method: string, body?: BackupSettings, signal?: AbortSignal): Promise<BackupStatus> {
  const response = await fetch(`/api/backups${path}`, {
    method,
    signal,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new BackupApiError('백업 서버의 응답을 확인하지 못했어요. 상태를 다시 불러와 주세요.', response.status); }
  if (!response.ok) {
    const error = data as { error?: unknown };
    throw new BackupApiError(typeof error?.error === 'string' ? error.error : '백업 요청을 확인하지 못했어요. 다시 시도해 주세요.', response.status);
  }
  const result = data as BackupStatus;
  if (!result?.settings || typeof result.settings.enabled !== 'boolean' || typeof result.running !== 'boolean' ||
      !Array.isArray(result.history) || typeof result.backupDir !== 'string')
    throw new BackupApiError('백업 상태를 확인하지 못했어요. 다시 불러와 주세요.');
  return result;
}

export const loadBackupStatus = (signal?: AbortSignal) => request('', 'GET', undefined, signal);
export const saveBackupSettings = (settings: BackupSettings) => request('', 'PUT', settings);
export const runBackupNow = () => request('/run', 'POST');
