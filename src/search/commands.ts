export type WorkspaceCommandId = 'memo' | 'page' | 'task' | 'ai' | 'outline' | 'move' | 'favorite';
export type WorkspaceCommand = {
  id: WorkspaceCommandId;
  label: string;
  hint: string;
  keywords: string;
};
const common: WorkspaceCommand[] = [
  { id: 'memo', label: '새 메모 작성', hint: '빠른 입력', keywords: '기록 메모 memo note capture' },
  { id: 'page', label: '새 페이지 만들기', hint: '빈 문서', keywords: '페이지 문서 page document' },
  { id: 'task', label: '할 일 추가', hint: '할 일 목록', keywords: '할일 todo task' },
  { id: 'ai', label: 'AI 요청 작성', hint: '리서치 · 직접 요청', keywords: 'ai research 리서치' },
];
const currentPage: WorkspaceCommand[] = [
  {
    id: 'outline',
    label: '현재 페이지 목차 보기',
    hint: '제목으로 이동',
    keywords: '목차 outline',
  },
  {
    id: 'move',
    label: '현재 페이지 이동',
    hint: '다른 상위 페이지 선택',
    keywords: '이동 옮기기 move',
  },
  {
    id: 'favorite',
    label: '현재 페이지 즐겨찾기 전환',
    hint: '사이드바에 보관',
    keywords: '즐겨찾기 favorite star',
  },
];
export function workspaceCommands(query: string, hasPage: boolean) {
  const terms = query.normalize('NFC').trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return [...common, ...(hasPage ? currentPage : [])].filter((command) =>
    terms.every((term) =>
      `${command.label} ${command.hint} ${command.keywords}`.toLocaleLowerCase().includes(term),
    ),
  );
}
export const PAGE_OUTLINE_EVENT = 'leneu:page-outline';
