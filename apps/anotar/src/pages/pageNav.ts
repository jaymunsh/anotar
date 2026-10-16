import { createContext } from 'react';

// 페이지 작업 공간 안에서 같은 앱 셸로 이동하는 함수.
// 제공자가 없을 때는 전체 탐색으로 대체한다.
export const PageNavContext = createContext<(path: string) => void>((path) => {
  window.location.href = path;
});
