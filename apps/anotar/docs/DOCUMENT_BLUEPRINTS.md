# 기본 문서 템플릿 사용

`shared/documentBlueprints.ts`는 UI와 개인 서버가 함께 사용하는 기본 정의입니다. 새 작성 목록에는 리서치(`research`), 회의(`meeting`), 개발 기록(`development`)을 제공합니다. 여행(`travel`)은 별도 서비스로 분리하기 위해 목록과 UI에서 제외하며, `legacyDocumentBlueprints`와 기존 상세 조회/생성 함수는 호환용으로 유지합니다. 사용자가 저장한 `/api/page-templates`와 별개이며 이를 수정하거나 삭제하지 않습니다. 클라이언트 번들에서도 생성하므로 서버 조회 없이 사용할 수 있습니다.

## 에이전트 조회

개인 서버에서만 읽습니다. 공개 공유 서버에는 등록하지 않습니다.

```sh
curl http://127.0.0.1:8787/api/document-blueprints
curl 'http://127.0.0.1:8787/api/document-blueprints/travel?startDate=2026-10-03&days=3'
```

목록은 `{items: [{id, title, icon, description, version, instructions}]}`를 반환합니다. 상세는 `{item, payload: {title, icon, document}}`입니다. `item.instructions`의 공통·문서별 작성 규칙과 `version`을 읽고 작업하세요. 조회할 때마다 `payload.document.blocks`에 새 UUID를 만듭니다. 조회 자체는 아무것도 저장하지 않습니다. GET 외에는 405, 없는 ID는 404, 잘못된 입력은 400입니다.

상세의 쿼리 입력:

- `title`: 선택, 공백 제거 후 최대 160자. 비어 있으면 기본 제목.
- 여행 `startDate`: 선택, 실제 달력에 있는 `YYYY-MM-DD`. 없으면 날짜 미정.
- 여행 `days`: 선택, 정수 1–14, 기본 3일. 시작 날짜가 있으면 UTC 달력 연산으로 일차별 날짜를 만듭니다. 마지막 날짜는 9999년 이내여야 합니다.

여행은 날짜마다 제목·우선순위 메모·독립적인 일정 블록을 만듭니다(1–14개). 각 일정표는 비어 있으며 확인한 항목을 추가한 뒤 해당 날짜의 지도·시간표로 사용할 수 있습니다. 날짜별 제목은 작성 공간이며 예약이나 방문 계획을 뜻하지 않습니다. 뒤에는 예약과 교통, 예산 분류, 미완료 준비물 체크리스트, 비상 연락과 대안, 공유 전 확인, 출처가 이어집니다. 금액·예약·연락처·좌표를 생성하지 않습니다. 일정의 고정 `Asia/Seoul` 스키마는 현지 시간 자동 변환 기능이 아닙니다. 해외 일정은 문서에서 시간 기준을 명시하세요.

## 문서 작성·저장

Node.js 24 또는 브라우저의 같은 함수를 직접 사용할 수도 있습니다.

```js
import { buildDocumentBlueprint } from '../shared/documentBlueprints.ts';
const payload = buildDocumentBlueprint('research', { title: '조사할 주제' });
// payload: {title, icon, document: {schemaVersion: 1, blocks}}
```

1. 해당 `instructions`를 읽습니다. 작성 안내 문구는 사실이 아닙니다.
2. 확인한 자료로 본문을 채웁니다. 출처·미확인·해석을 구분하며 여행 예약·요금·좌표나 검증 결과를 추측하지 않습니다.
3. 원시 개인 HTTP API에서 새 페이지는 `POST /api/pages`에 `{title, icon}`을 보내 먼저 생성합니다. 응답의 `item.id`와 `item.version`을 즉시 보존합니다. 이 POST는 `document`를 저장하지 않습니다.
4. 반환된 ID에 `PUT /api/pages/:id`로 `{expectedVersion: created.version, title, icon, document}`를 보내 본문을 저장합니다. 기존 페이지도 먼저 GET으로 현재 문서와 버전을 읽고 보존할 블록/ID/첨부를 유지한 뒤 같은 PUT 계약을 사용합니다. `PATCH`는 위치·부모 이동용입니다.
5. PUT 응답을 받지 못했거나 재시도할 때는 보존한 ID를 GET으로 조회하고 제목·아이콘·본문을 원래 payload와 비교합니다. 이미 적용됐으면 완료로 처리합니다. 변경이 없다면 확인한 버전으로 재시도하고 다른 변경이 있다면 충돌을 해결합니다. 새 POST를 반복하거나 새 블록 ID를 생성하지 않습니다. POST 자체의 응답을 잃어 ID가 없으면 목록을 확인해 생성 여부부터 해결하고 맹목적으로 재생성하지 않습니다.
6. 저장 응답과 재조회로 결과를 확인합니다. 조회 템플릿 API는 문서를 저장하지 않습니다.

브라우저 UI는 `workspaceFetch`의 기기 저장·동기화 경로에서 `{title, icon, document}`를 하나의 로컬 생성 입력으로 처리합니다. 이 로컬 계약을 원시 서버 POST와 혼동하지 마세요.

프론트 `DocumentBlueprintPicker`의 `onSelect(payload)`는 생성 결과만 전달합니다. `onClose`는 취소/닫기이며 `disabled`는 생성·입력 잠금입니다. 선택적 `error` 문자열로 호출자의 생성 오류를 창 안에 표시합니다. 저장 실패·기기 복구·중복 제출·부모 페이지 연결 처리는 호출자가 기존 흐름으로 관리합니다.

## 앱에서 사용하기

- 입력함의 **최근 페이지 → 템플릿으로 만들기**에서 새 문서를 만듭니다.
- 빈 페이지의 **템플릿으로 시작**은 현재 빈 페이지에 제목·아이콘·본문을 적용합니다. 이미 작성한 본문은 대체하지 않습니다.
- 페이지 상단 **자료 가져오기**(모바일에서는 더보기 안)에서 메모·페이지·AI 결과를 검색합니다. 원문 일부를 선택하거나 전체를 **본문 끝에 넣기**로 복사합니다.
- 자료의 원본·정리 상태는 바뀌지 않습니다. 첨부 파일과 앱 전용 참조 블록은 복사하지 않습니다. 가져올 문서가 서버의 길이·블록 수·링크 규칙을 넘으면 삽입 전에 거절합니다.
- 템플릿 생성과 편집은 기존 기기 저장·동기화를 사용합니다. 오프라인 자료 검색 범위는 그 기기에 보관된 자료이며, AI 결과는 해당 기기에 이미 읽어 둔 결과만 열 수 있습니다.
- 여행은 새 작성 메뉴에서 제외했습니다. 기존 여행 문서와 사용자 저장 템플릿은 보존합니다. [분리·재활용 인계](handoffs/2026-10-05-travel-service-extraction.md)를 확인하세요.
