import { X } from 'lucide-react';
import type { TrashEntry } from './types';
import { useTrashOperation } from './useTrashOperation';
import { publishRecordChange } from './events';
import './trash.css';

export default function TrashNotice({
  entry,
  onClose,
}: {
  entry: TrashEntry;
  onClose: () => void;
}) {
  const operation = useTrashOperation();
  async function undo() {
    const restored = await operation.run(() => ({
      path: `/api/trash/${entry.id}/restore`,
      body: { operationId: crypto.randomUUID() },
    }));
    if (restored) {
      onClose();
      publishRecordChange('undo');
    }
  }
  return (
    <div className="trash-notice" role="status">
      <div>
        <span>휴지통으로 옮겼어요.</span>
        <small title={entry.label}>{entry.label}</small>
      </div>
      <button className="trash-undo" disabled={operation.busy} onClick={() => void undo()}>
        {operation.busy ? '확인 중…' : operation.pending ? '같은 요청 다시 확인' : '되돌리기'}
      </button>
      <button
        className="trash-notice-close"
        aria-label="안내 닫기"
        disabled={operation.busy}
        onClick={onClose}
      >
        <X size={16} />
      </button>
      {operation.error && (
        <p className="trash-notice-error" role="alert">
          {operation.error}
        </p>
      )}
    </div>
  );
}
