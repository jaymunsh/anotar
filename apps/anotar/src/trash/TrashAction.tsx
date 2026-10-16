import { useOnlineAction } from '../sync/onlineActions';
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTrashOperation } from './useTrashOperation';
import { publishRecordChange } from './events';
import type { TrashEntry } from './types';
import './trash.css';

type Props = {
  kind: 'capture' | 'page';
  id: string;
  version: number;
  childCount?: number;
  disabled?: boolean;
  onMoved: (entry: TrashEntry) => void;
  onPendingChange?: (pending: boolean) => void;
};

export default function TrashAction({
  kind,
  id,
  version,
  childCount = 0,
  disabled = false,
  onMoved,
  onPendingChange,
}: Props) {
  const onlineReason=useOnlineAction(kind,id);
  disabled=disabled||Boolean(onlineReason);
  const operation = useTrashOperation();
  const [confirming, setConfirming] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    onPendingChange?.(operation.pending);
  }, [operation.pending, onPendingChange]);
  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);
  async function move() {
    const entry = await operation.run(() => ({
      path: `/api/${kind === 'page' ? 'pages' : 'captures'}/${id}/trash`,
      body: { operationId: crypto.randomUUID(), expectedVersion: version },
    }));
    if (entry) {
      onMoved(entry);
      publishRecordChange('trash');
    }
  }
  return (
    <div title={onlineReason || undefined} className={`trash-action ${kind === 'page' ? 'trash-action-menu' : ''}`}>
      {confirming && !operation.pending ? (
        <div className="trash-confirm">
          <p>이 페이지를 휴지통으로 옮겨요.</p>
          {childCount > 0 && <p>하위 페이지 {childCount}개도 함께 이동해요.</p>}
          <div>
            <button onClick={() => setConfirming(false)}>취소</button>
            <button ref={confirm} disabled={disabled || operation.busy} onClick={() => void move()}>
              확인하고 이동
            </button>
          </div>
        </div>
      ) : (
        <button
          className="trash-move-button"
          disabled={operation.busy || (disabled && !operation.pending)}
          onClick={() => {
            if (kind === 'page' && !operation.pending) setConfirming(true);
            else void move();
          }}
        >
          <Trash2 size={15} />
          {operation.busy
            ? '확인 중…'
            : operation.pending
              ? '같은 요청 다시 확인'
              : '휴지통으로 이동'}
        </button>
      )}
      {disabled && !operation.pending && (
        <p className="trash-action-help">저장을 마친 뒤 휴지통으로 옮길 수 있어요.</p>
      )}
      {operation.error && (
        <div className="trash-action-error" role="alert">
          <span>{operation.error}</span>
          {operation.conflict && <button onClick={() => location.reload()}>최신 내용 보기</button>}
        </div>
      )}
    </div>
  );
}
