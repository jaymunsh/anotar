import type { SyncOperation } from '../../shared/sync';

/** An alert opens the original workspace; comparison stays in that workspace. */
export function noticeDestination(operation: SyncOperation) {
  const query = '?syncConflict=' + encodeURIComponent(operation.operationId);
  const id = encodeURIComponent(operation.entityId);
  if (
    operation.kind.startsWith('page.') ||
    (operation.kind === 'ai.submit' && operation.payload.sourceKind === 'page')
  )
    return { path: '/pages/' + id + query, label: '해당 페이지에서 확인' };
  if (operation.kind.startsWith('journal.'))
    return { path: '/journal' + query, label: '일지에서 확인' };
  if (operation.kind.startsWith('task.'))
    return { path: '/tasks' + query, label: '할 일에서 확인' };
  return { path: '/captures/' + id + query, label: '해당 메모에서 확인' };
}
