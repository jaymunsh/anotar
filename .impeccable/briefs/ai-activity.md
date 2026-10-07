# AI 요청 현황·모니터

2026-09-30. 완료된 기존 Operate 화면 확장의 기록이다. 대상은 홈(`/`)의 AI 현황과 `/ai`, 구현은 `src/ai/AiActivity.tsx`와 `activity.css`다.

## 목적과 범위

사용자가 저장한 AI 메모를 다시 찾고 처리 상태·정확한 요청 결과에 접근한다. 메모·Page 실행 이력을 함께 보여주고 실행 전 보관 요청문은 `/memo?view=ai`로 연결한다. 원본 저장·초안과 결과 채택은 기존 계약을 따른다.

## Direction contract

**THESIS:** 저장 뒤 흩어진 AI 요청을 실제 상태·정확한 작업 링크로 다시 찾는 작업 목록이다. 홈은 빠른 입력을 먼저 두고 그 아래에 작은 현황을 둔다.

**OWN-WORLD:** 기존 [DESIGN.md](../../DESIGN.md)와 [디자인 사이드카](../design.json)의 종이·숲색 / 차콜·세이지, 앱 서체·테마 변수·얇은 경계·작은 조작을 이어 쓴다. 이 작업은 기존 시각 체계의 확장이다.

**STORY:** 사용자는 홈에서 진행 중 요청을 발견하고 전체 모니터의 상태로 좁힌 뒤 해당 요청의 메모 결과 또는 Page AI를 연다. 새 요청은 입력함으로 돌아가 현재 초안과 함께 작성한다.

**FIRST VIEWPORT:** `/ai`의 첫 줄은 제목과 새 요청, 아래는 안내·상태별 전체 개수·요청 행이다. 행에는 소유 유형·템플릿/페이지 제목·입력 요약·아이콘과 상태·요청/시작/종료 시각을 둔다. 모바일은 줄바꿈하며 모니터의 공통 하단 도크를 숨긴다.

**FORM:** 기존 관리 목록의 Operate 구성을 코드로 확장했다. 새로운 visual-world workshop·seed·comp는 수행하지 않았다. 구현 전 범위는 [작업 scope](../../.omo/evidence/ai-monitor-scope.md)에, 이 brief는 마지막 수정 뒤 문서화한 전략과 현재 동작을 담는다.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 구현 계약

- 홈은 진행 중 우선 최대 3개, `/ai`는 선택 상태의 최근 50개와 DB 전체 개수다. 정리 완료 메모의 작업을 포함하며 휴지통 소유자는 제외한다.
- 정확한 `aiJob` 링크를 선택하고 최신 이력 밖의 작업은 소유자를 검사한다. Page AI는 자동으로 펼치고 연결된 메모 상세를 닫으면 `/ai`로 돌아온다.
- 실제 교차 알림 이후 가시·활성 탭에서만 조회한다. 진행 중 2초, 나머지·실패 30초이며 숨김·이탈에는 취소한다. 오류는 마지막 확인 기준과 재시도를 표시한다.
- 읽기 전용 요약에는 제한된 입력·제목과 상태만 담고 전체 요청문·결과·파일·문서를 보내지 않는다. **새 AI 요청**은 기존 초안을 보존한다.
- API·라우트·한도는 [현재 구현 규격](../../CURRENT_IMPLEMENTATION.md#ai-요청-모니터)이 기준이다. 새 팔레트·전역 토큰·이미지를 추가하지 않았다.

## 종료 근거와 남은 범위

[수정 verdict](../../.omo/evidence/ai-monitor-review-verdict.md)는 화면 밖 최초 조회와 모바일 도크의 기존 두 지적을 해결로 판정했다. 새 전체 화면 승인으로 확대하지 않는다. [대상 QA](../../.omo/evidence/ai-monitor-ui-reviewed.log)는 임시 저장소·로컬 worker와 1327/390/320px 양쪽 테마를 확인했으며 실제 제공자는 호출하지 않았다. 이번 전체 `scripts/qa.mjs`는 다시 실행하지 않았다.

기존 `DESIGN.md`·사이드카는 보존했다. 소스·기존 화면 캡처·디자인의 비교와 문서 확인은 [문서 기록](../../.omo/evidence/ai-monitor-documentation.md)에 남긴다. 일반 목록의 이전 이력은 개별 원본에서 찾으며 이 모니터에는 더 보기·실행 취소·자동 재시도가 없다.
