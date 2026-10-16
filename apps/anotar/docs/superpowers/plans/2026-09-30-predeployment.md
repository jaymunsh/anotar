# 서버 이전 전 완성 작업

Spec: docs/superpowers/specs/2026-09-30-predeployment.md
Execution: native sequential. Existing authorized working folder; preserve dirty changes. No commits.

### Task 1: 일정 읽기·작성
- [x] shared/itinerary.ts 시작 제안 함수와 test/itinerary-activities.test.mjs 테스트 RED→GREEN.
- [x] ItineraryBlock.tsx와 itinerary.css: PC 2열, 모바일 이미지 우선, 제목·시간 강조, 작성 항목 접기/펼치기.
- [x] 공개 share-plan.css/renderSharedPage의 동일 읽기 배치.
- [x] 타입/단위 테스트, 최종 통합 화면 확인.

### Task 2: 개인 블록 댓글
- [x] server/pageComments.mjs thread/message/UUID receipt와 tests RED→GREEN: 재전송/충돌/휴지통/사라진 블록 보존.
- [x] store/index 개인 API; PageCommentPreview.tsx를 서버 저장으로 연결, 실패 초안 유지.
- [x] 공개 프로세스 격리 검증.

### Task 3: 오프라인 내보내기
- [x] server/pageExport.mjs native ZIP stream + tests RED→GREEN: 현재 직접 refs/안전한 경로/누락/CRC/버전.
- [x] 개인 export endpoint, PageEditor 더보기 다운로드.
- [x] ZIP를 풀어 네트워크 없이 읽는 브라우저 검증.

### Task 4: AI 결과→할 일
- [x] server/ai/taskAdoption.mjs atomic selected task creation + UUID receipt, tests RED→GREEN.
- [x] 결과 패널의 체크리스트 후보 선택·수정·확인 UI. 기존 TaskWorkspace 갱신.

### Task 5: 명시 OCR
- [x] 별도 이미지 HTTP 게이트웨이 계약/저장/단일 worker, fixture tests RED→GREEN.
- [x] 개인 첨부의 요청·상태·결과 확인. 원본 보존, 초과/중단/미설정 안내.

### Task 6: 검색·프롬프트 이력
- [x] 기존 FTS 파생 인덱스의 Task/AI result/OCR 확장, 쓰기·삭제·복원 tests RED→GREEN.
- [x] 검색 타입/이동과 프롬프트 수정본 조회·새 수정본 복원 UI.

### Task 7: 배포 준비·검증·문서
- [x] Docker 개인/공개 healthcheck와 Linux 실행/runner/백업 복원 가이드.
- [x] 전체 tests/build/대상 Chrome QA, 로컬 검색·번들 측정 기록.
- [x] CURRENT_IMPLEMENTATION/README/AGENTS/DESIGN 및 roadmap 상태 갱신.
- [x] 마지막 전체 변경 리뷰. 실제 서버 단계와 외부 설정 한계를 보고.

Interfaces: page comments/OCR/tasks use shared SQLite handle; public renderer is reused by offline export; OCR/job/task text integrates existing FTS after those tables exist. New private APIs must not be registered on public server.

검증 완료: [.omo/evidence/predeployment/REPORT.md](../../../.omo/evidence/predeployment/REPORT.md). 실제 외부 실행기·도메인/Tailscale/Tunnel·N100 장비 검증은 배포 단계에서 진행한다.
