import { useSyncExternalStore } from 'react';
import { CloudOff } from 'lucide-react';
import { getSyncSnapshot, subscribeSync } from './runtime';
import './sync.css';

// 온라인 전용: 연결이 끊겼을 때만 사이드바에 한 줄로 조용히 알린다.
// 예전 동기화 대기·충돌 상세 패널은 제거했다.
export function SyncStatus(_props: {
  onNavigate?: (path: string) => void;
  onOpenStorage?: () => void;
}) {
  const status = useSyncExternalStore(subscribeSync, getSyncSnapshot);
  if (status.state !== 'offline') return null;
  return (
    <div className="sync-status">
      <span className="sync-status-trigger" role="status" aria-label="연결 상태">
        <CloudOff size={14} aria-hidden />
        <span>연결 끊김 · 연결 후 저장돼요</span>
      </span>
    </div>
  );
}
