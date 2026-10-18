# 기간별 시간·실행 상태 설계

2026-10-12. 오늘 시간표를 중심으로 주간·월간·분기·연간을 연결한다.

## 현재 로컬에 적용한 범위

- 시간표의 일정 추가와 수정은 하나의 간단한 모달을 사용한다.
- 기본 필드는 활동명·시작·종료다. 상태와 장기 작업 연결은 추가 설정에 있다. 수정에서는 추가 설정을 펼쳐 현재 상태를 확인한다.
- 저장 후 시간표로 돌아간다. 취소·닫기·Escape에서 미저장 입력이 있으면 확인한다. 모달은 키보드 초점을 내부에 유지하고 닫으면 원래 조작으로 돌아간다.
- 오늘의 첫 화면 높이를 모달 때문에 늘리지 않는다. 작은 화면에서 모달 자체가 스크롤된다.
- 주간·월간·분기·연간에서 계획 합계와 체크한 오늘 할 일 수를 확인한다.
- 완료·일부 수행·미이행·미룸 표시·수행 확인 전·취소를 선택하면 해당 항목 목록을 표시한다. 항목을 누르면 원래 날짜의 일지로 돌아간다.
- 주간은 월요일~일요일, 월간은 달의 시작~끝, 분기는 1~3/4~6/7~9/10~12월, 연간은 1~12월이다.
- 주간·월간은 날짜별, 분기·연간은 월별 시간과 상태를 집계한다.

## 집계 의미

| 항목 | 기준 |
| --- | --- |
| 계획 합계 | 취소가 아닌 계획의 기간 합. 겹친 계획은 각각 포함 |
| 계획이 차지한 시간 | 날짜별 계획 구간을 합쳐 중복 시간을 한 번만 계산 |
| 이전 실제 기록 | 저장·내보내기에 보존하며 현재 일지 화면의 집계·표시에는 사용하지 않음 |
| 오늘 할 일 완료 | 내용이 있는 우선순위 중 직접 체크한 항목 수 |
| 완료·일부 수행 | 사용자가 표시한 계획 상태 |
| 미이행 | 직접 미이행으로 표시한 계획. 시간이 지났다는 이유로 자동 변경하지 않음 |
| 미룸 표시 | 현재 deferred 상태인 계획 수. 미룬 횟수와 다름 |
| 수행 확인 전 | pending 상태. 미래 예정과 수행 미확인 항목 모두 포함하며 실패를 의미하지 않음 |
| 취소 | 취소한 계획 수. 계획 시간 합계에서는 제외 |

계획 합계와 실제 시간 차이를 그대로 낭비로 해석하지 않는다. 계획이 겹쳤을 수 있고, 실제 활동을 아직 기록하지 않았을 수 있다. 장기 할 일 완료·오늘 우선순위 완료·일정 구간 수행은 각기 다른 값이다.

## 기간 조회와 자료 보호

새 기간 조회 API는 GET /api/days?from=YYYY-MM-DD&to=YYYY-MM-DD다. 두 날짜의 유효성, 순서, 최대 366일을 검사한다. 로그인한 사용자의 범위 기록만 조회한다. 이전의 최근 400일 제한 때문에 오래된 연간 자료가 누락되는 것을 피한다. 범위 없는 기존 조회는 최근 400일을 유지한다.

조회 실패 시 부분 자료를 완전한 합계처럼 표시하지 않는다. 다시 불러오기를 제공한다. 언어 전환으로 사용자 원문을 번역하거나 기록을 초기화하지 않는다. 기존 저장 버전과 기기 초안 보호를 유지한다.

## 다음 단계: 실제 미루기 이력

현재 상태 집계와 날짜 이동 이력은 구분해서 개발한다. 후속 단계에서는 다음 정보가 필요하다.

- 하나의 작업을 가리키는 안정적인 ID
- 원래 계획 날짜·시간, 새 계획 날짜·시간
- 선택적 이유: 예상보다 오래 걸림 / 우선순위 변경 / 외부 일정 / 직접 작성
- 이동 이벤트 ID·시각·사용자 ID
- 원래 기록을 보존하고 새 일정으로 연결하는 관계

이력이 생긴 뒤에만 미룬 횟수, 최초 계획 이후 지연 기간, 자주 미루는 작업, 이유별 분포를 제공한다. 기존 deferred 플래그로 과거 이동 횟수나 이동 날짜를 추정해 만들어내지 않는다.

미이행·미룸 목록에는 원하는 날짜에 다시 계획하는 동작을 추가할 수 있다. 이동과 복사를 구분하고, 원래 기록이 무엇인지 분명하게 표시해야 한다. 후속 이동은 두 날짜의 버전을 함께 검사하는 서버 트랜잭션과 이벤트 중복 방지가 필요하다.

## 목표·성과 연결

연간 목표 → 분기 단계 → 월간 결과 → 주간 중요 작업 → 오늘 시간 배치를 선택적으로 연결한다. 모든 단계 입력을 의무화하지 않는다. 목표의 실제 결과 진척과 투입 시간을 따로 표시한다.

첫 회고 질문은 잘된 점, 계획이 달라진 이유, 다음에 바꿀 한 가지다. 더 큰 기간에서는 아래 질문으로 연결한다.

- 주간: 미완료·미룸의 원인과 다음 주에 조정할 계획
- 월간: 목표별 결과와 시간 배분 변화
- 분기: 유지할 방향·조정할 목표
- 연간: 주요 결과와 다음 해의 집중 영역

목표 트리·이동 이력·사유 분석·기간별 회고 전용 저장은 후속 범위이며 현재 로컬 구현으로 주장하지 않는다.

## 검증

서버 및 집계 테스트: npm test. 모달·기간 화면: node scripts/qa-modal-period.mjs.

윤년·연말을 넘는 주간 경계, 분기 경계, 중첩 계획·실제 구간, 명시적 상태, 취소 제외, 오래된 연간 자료와 계정 격리를 검사한다. 모달 초점·Escape·미저장 확인·저장 후 복귀·새로고침, 기간 필터, 320px 모바일, 조회 실패 시 합계 숨김을 검사한다. 테스트는 임시 계정·임시 DB를 사용한다.

운영 서버에는 아직 반영하지 않았다. 로컬 검토 이후 별도 배포한다.

## Period diary presentation

The primary period screen is now a calendar/time diary: seven-day scheduled-plan tracks, monthly activity calendar, three-month quarter spread and twelve-month yearly record map. Saved daily reflections appear on week and month/quarter sheets. Empty yearly dates stay unfilled. Status filtering remains in a disclosure without hiding the diary. Year month headers open the month and dates open daily journals. This is saved-record visualization; separate editable period goals and period-wide reflection storage remain future work. Verify via node scripts/qa-period-diary.mjs.

## Weekly display correction

Past journals navigation was removed. Its legacy URL redirects to the monthly diary. Each weekly day now uses one full-width activity track, with status styling. Separate actual entries are excluded from all journal display, totals, legends and tooltips. Concurrent plans share width only within their overlap group. Stored legacy entries remain preserved and exportable.
