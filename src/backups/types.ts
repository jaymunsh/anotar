export type BackupSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
  retention: number;
};

export type BackupRun = {
  id: string;
  name: string;
  path: string;
  trigger: 'manual' | 'scheduled';
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'succeeded' | 'failed';
  error: string | null;
  available: boolean;
};

export type BackupStatus = {
  settings: BackupSettings & { timeZone: 'Asia/Seoul' };
  running: boolean;
  nextRunAt: string | null;
  lastGood: BackupRun | null;
  history: BackupRun[];
  error: string | null;
  backupDir: string;
};
