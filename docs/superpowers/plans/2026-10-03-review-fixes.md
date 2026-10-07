# 검토 네 항목 수정 계획

목표: 승인된 오프라인 상세, 개인 API 출처 보호, 기본 저장 QA, 검색 상태 문구만 수정한다.

현재 재현과 CURRENT_IMPLEMENTATION.md를 기준으로 직접 실행한다. 기존 수정·원본 data/.env를 보존하며 테스트는 별도 source snapshot과 임시 DB를 사용한다. 커밋·배포·네트워크 설정 변경은 하지 않는다.

- [x] public/capture-worker.js의 captures 경로와 쿼리 링크를 실패 테스트로 고정하고 수정한다. API/share/외부 origin 제외는 유지한다.
- [x] server/privateRequests.mjs의 공통 Host/Origin 검사와 server/index.mjs 진입 검사를 구현한다. 외부 multipart·JSON 변경 거절, CLI·Vite·명시 HTTPS 프록시 허용을 HTTP 회귀로 검증한다.
- [x] server/search.mjs의 AI 요청 원본 문구와 같은 읽기 savepoint의 Task 상태 조회를 수정한다. todo/doing/done/되돌리기 및 완료 AI 원본/결과를 테스트한다.
- [x] scripts/qa.mjs의 첫 저장을 기기 저장·입력 초기화·중복 없는 서버 동기화로 검증한다.
- [x] 최종 소스 test/build/typecheck와 기본·검색·PWA·offline·sync/mobile/workspace 게이트를 임시 데이터로 실행한다. 실패는 숨기지 않고 수정 범위와 기존 제한을 구분한다.
- [x] 실제 Mac Chrome에서 최종 격리 실행을 확인하고 결과를 보고한다.

검증 결과: 원본 build(TypeScript 포함)·Node 341/341·PWA 상세/쿼리 오프라인 QA 통과. 동일한 최종 소스의 격리 복사본에서 offline 15개와 sync/mobile/workspace/search 4개 QA 통과. 기본 QA는 기기 저장·초기화·서버에 한 번만 동기화 검사 이후 scripts/qa.mjs:113의 NEW 배지 검사에서 실패했다. 해당 배지 제품 수정은 승인 범위 밖으로 남겼다. 실제 Mac Chrome에서 합성 메모의 쿼리 링크를 열고 임시 서버를 종료한 뒤 새로고침해 원문 유지·서버 연결 대기를 확인했다. 원래 실행 서비스의 미허용 Host 요청은 403, 실제 검색 화면의 Task 대기와 AI 요청 원본 문구도 확인했다. 실제 data/.env·원본 업무 기록과 별도 네트워크/운영 설정을 변경하지 않았다.
