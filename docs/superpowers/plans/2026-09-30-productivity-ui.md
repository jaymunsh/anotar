# 생산성 UI 구현 계획

Spec: [설계](../specs/2026-09-30-productivity-ui-design.md). 기존 dirty workspace 보존, 커밋/원격 배포 없음. 구현은 독립 소유 파일로 병렬 진행하고 root가 공용 wiring을 맡는다. 사용자 목적·다섯 항목 승인은 직전 대화에서 확인됐으며 routine 설계 문서/실행 방식 재승인을 요구하지 않는다.

- [x] Task 1: 서버 `workspacePages.mjs`, `PageWorkspace.tsx`, 새 workspace navigation/context/CSS, unit/QA. private favorite/read metadata, 성공 열람 기록, 트리 이동 명시 선택/오류/재시도, 홈 계속 작업 portal. Root store/index/main wiring; PageEditor 수정은 Task3 소유자에게 snippet 제공.
- [x] Task 2: `pageConnections.mjs` batch extension, `CaptureCollection.tsx`, 새 `CaptureBatchImport`/CSS/types, unit/QA. 한 Page에 최대20 Capture 원자 정리, 명시 선택/버전/UUID/응답 유실 복구. Root API/main detail integration. 본문에 captureRef 카드 자동 삽입 금지.
- [x] Task 3: `PageEditor.tsx`, `pages.css`, `SearchPalette.tsx/search.css`, 새 command helpers/tests/QA. 맥락별 블록 도구·페이지 메뉴 분류, 명령 검색과 정확한 keyboard/IME. Task1 workspace event/context 연결.
- [x] Task 4: root owns `main.tsx`, `store.mjs`, `index.mjs`, 새 메모 split container/CSS, 홈·쉘·용어·글씨 규격, docs. 세 task interfaces 통합, PC split 및 이전/다음 보호, 보조 탐색 묶음.
- [x] Task 5: 의미 있는 영향 tests, full npm test/build, 통합 browser QA, 각 scope+전체 독립 검토, 지적 수정, 사용자 화면 안내와 evidence.

## 충돌 점검

| 관계 | 인터페이스·소유 | 판정 |
| --- | --- | --- |
| 1/3 | PageWorkspace→PageEditor 이동/즐겨찾기 이벤트 또는 별도 Context | 1은 bridge 새 파일, 3만 PageEditor 수정 |
| 2/4 | CaptureCollection batch callback, CaptureBatchImport props | 2 제공, 4 main 통합 |
| 1/2/4 | store/index/main | root 전용 |
| 1/3/4 | 스타일 | 1 새 workspace CSS, 3 pages/search CSS, 4 새 productivity CSS와 shell만 |
| 각 task | 원본 보존과 검증·소유 파일 | spec와 일치; 사용자의 실제 data/seed 변경 금지 |

증거와 baseline은 `.omo/evidence/productivity-ui/`에 보존한다. 이번 변경을 HEAD 전체 diff와 혼동하지 않도록 baseline source와 비교한 scoped patch를 검토자에게 전달한다.

## 완료 확인 (2026-10-01)

전체 테스트 274/274, 최종 production build, navigation 최종 Chrome QA, batch/detail/commands/42-block sticky tools QA, 기존 통합검색·Page connections 회귀 QA 통과. Root 소유 코드와 탐색 코드에 독립 검토를 받았고 지적은 수정 및 재검증했다. 사용자 데이터·외부 AI 호출·원격 배포·커밋 없이 진행했다. 증거: `.omo/evidence/productivity-ui/REPORT.md`.
