# anotar 여행 기능 분리와 재활용 인계

2026-10-05 사용자 승인: 여행 전용 지도·일정·기본 문서 템플릿의 새 작성 진입점을 제거하고, 별도 여행 공유 서비스에서 재활용할 자료를 보존한다. 이번 작업은 신규 여행 서비스 구현이나 실제 문서의 삭제·변환이 아니다.

## 적용 범위

- PageEditor의 `/` 메뉴에서 지도·일정을 제외한다. 블록 스키마의 `map`·`itinerary`는 유지한다.
- 새 문서 템플릿 목록과 개인 API 목록은 리서치·회의·개발 기록만 제공한다.
- 여행 정의는 `legacyDocumentBlueprints`로 구분한다. 기존 에이전트가 사용한 `buildDocumentBlueprint('travel')`과 상세 GET은 호환용으로 유지한다.
- 기존 Page 본문·ID·버전·첨부·일정 ID와 댓글 앵커·공유·내보내기·오프라인 저장 계약은 유지한다. 사용자 저장 페이지 템플릿과 AI 프롬프트 라이브러리를 삭제/보관 처리하지 않는다.
- 지도·일정 신규 개발은 별도 서비스에서 진행한다. 호환 구현 제거는 기존 문서를 일반 블록으로 안전하게 변환하고 검증한 후 별도 작업으로 진행한다.

## 재활용 묶음

로컬 보관 위치: `/Users/sunghyuk/Documents/Leneu/leneu-anything/leneu-storage/backups/travel-extraction-20261005T103032164Z`

이 폴더는 Git·Docker에서 제외되는 `backups/` 안에 있다. 여행 문서에 개인 정보가 있을 수 있으므로 공개 저장소에 그대로 복사하지 않는다. 폴더 권한은 0700이다.

- `manifest.json`: 생성 시각, 원본 경로, 페이지 ID/버전, 파일 크기와 SHA-256.
- `source/`: 메뉴 변경 전 지도·일정·문서 템플릿 구현, 관련 공통 모듈·공유 렌더러·내보내기·스타일·테스트·샘플 생성/QA 코드. 독립 실행 앱이 아니며 아래 의존성 정리가 필요하다.
- `saved-pages/<page-id>/page.json`: 저장된 여행/일정 문서 10개. 원본 JSON과 블록 ID·페이지 버전을 보존했다.
- `saved-pages/<page-id>/offline/index.html`: 같은 문서의 정적 읽기 사본. 직접 참조한 첨부와 스타일이 `offline/files`·`offline/assets`에 포함된다.
- `saved-pages/assets.json`: 직접 참조한 자산 5개의 ID·파일 정보. 오프라인 사본에는 실제 파일 바이트도 포함한다.
- `html-samples/`: 브라우저에서 검토한 오사카 안내서, 지도 중심 템플릿, 예약 편집형 템플릿 3개.

175개 파일, 약 24MB의 크기·체크섬을 복사 후 검증했다. 이는 서버에 저장된 문서의 사본이며 기기에서 아직 동기화하지 않은 초안은 포함하지 않는다. 비밀키·환경 파일·인증 테이블·개인 댓글·Task DB는 포함하지 않았다. 일정 연결에 개인 Task/Capture ID가 남아 있을 수 있지만 연결 대상 내용을 가져온 것은 아니다. 일반 페이지 링크 대상도 재귀 복사하지 않는다. 새 서비스에서 해당 참조를 해제하거나 별도 매핑한다.

기존 여행 샘플의 예약·가격·운행·좌표는 새로 조사한 정보가 아니다. 10월 5–8일 문서와 HTML의 10월 12–15일 샘플을 같은 여행으로 합치지 않는다. HTML의 외부 이미지/지도/길찾기는 네트워크가 필요할 수 있다.

## 재활용 코드 진입점

| 책임 | 원본 파일 | 새 서비스에서 조정할 것 |
| --- | --- | --- |
| 일정 검증·방문 번호·소요시간·겹침·Google 링크 | `shared/itinerary.ts` | 여행별 시간대, 자정 넘김, 항목 수, 확정 상태 |
| 날짜별 요약·메모 표시 | `shared/itineraryReading.ts` | 동행자에게 필요한 실행 안내와 교통 구간 구조 |
| 지도 번호·표시 장소·입력 지문·이미지 출처 | `shared/staticMap.ts` | 여행 자산 저장 방식과 표시 범위 |
| 자체 방문 위치 SVG | `shared/itineraryPreview.ts` | 실제 길찾기와 방문 순서 표시를 구분 |
| Geoapify 정적 지도 생성 | `server/geoapifyMaps.mjs` | 서버 저장소·자산 등록·요청 버전·생성 제한 연결 |
| 시간표 직접 편집 | `src/pages/ItineraryBlock.tsx`, `ItineraryInlineField.tsx` | BlockNote와 Page autosave 의존성을 여행 엔티티 저장으로 교체 |
| 지도 표시·이미지 선택 | `ItineraryMap.tsx`, `MapBlock.tsx`, `MapImageControls.tsx`, `PlanImagePicker.tsx` | 지도 설정 context·인증된 API·개인 업로드 의존성 |
| 준비 및 개인 자료 연결 | `PlanConnections.tsx`, `PlanConnectionsContext.tsx` | anotar Task/Capture ID를 신규 서비스 모델에 그대로 연결하지 않기 |
| 공유와 HTML/첨부 내보내기 | `server/publicPage.mjs`, `server/pageExport.mjs` | Page/공유 토큰 계약을 여행 읽기 권한과 자산 허용 목록으로 교체 |
| 읽기 스타일 | `public/itinerary-timetable.css`, `src/pages/itinerary*.css`, `mapBlock.css` | 여행 서비스의 글꼴·색상·모바일 배치에 맞추기 |
| 기본 여행 템플릿 | `shared/documentBlueprints.ts` | 안내 문구와 실제 계획 데이터 구분; 날짜별 작성 틀 참고 |

순수 일정/지도 계산 모듈부터 가져오고 React 편집기와 DB 접근은 이후 연결한다. 공유 렌더러 전체를 독립 서버로 복사해서 사용하지 않는다. 저장소 의존성과 개인 자료를 노출하지 않는 첨부 경계를 먼저 검토한다.

## 현재 일정 저장 형식

Page JSON의 `type: 'itinerary'`, `props.data`는 아래 객체를 JSON 문자열로 저장한다.

```json
{
  "version": 1,
  "title": "하루 일정",
  "timezone": "Asia/Seoul",
  "entries": [
    {
      "id": "원본-항목-id",
      "date": "2026-10-05",
      "start": "13:25",
      "end": "14:35",
      "title": "공항에서 숙소로 이동",
      "category": "travel",
      "note": "사용자가 입력한 안내 원문"
    }
  ]
}
```

선택 필드에는 `place`·`latitude`·`longitude`·`url`도 있다. 현재 규격은 Asia/Seoul 고정, 블록당 최대 50항목, 같은 날짜 안에서 시작/끝을 검증한다. 현지 시간 변환·자정 이후까지 이어지는 이동·예약 상태·실제 도로 경로 계산은 이 모델의 기능이 아니다. `category=travel`인 이동에는 방문 번호를 붙이지 않는다. 이미지의 `assetId`·`imageSource`·`imageInput`도 블록 props에 있으므로 문서 변환 시 보존한다. 생성 지도는 명시 실행이며 일정 편집마다 유료 제공자를 자동 호출하지 않는다.

새 서비스의 권장 단위는 여행 → 날짜 → 일정/이동 → 장소, 그리고 예약·예산·준비 항목이다. 후보와 확정, 작성자와 동행자 보기, 읽기 링크와 예약 개인정보 공개 범위를 각각 명확히 한다. 지금 보관한 코드를 그대로 새로운 제품의 최종 설계로 취급하지 않는다.

## 기존 문서의 이후 정리

1. 사본과 첨부 체크섬을 확인한다.
2. 사용자 승인 범위에서 지도는 일반 이미지와 장소 링크, 일정은 제목·표·목록으로 변환한다.
3. 변환 전후 날짜·시각·설명·첨부·참조·공유·Markdown·오프라인 사본을 비교한다. 댓글 앵커의 보존/변경을 명시한다.
4. 활성 본문뿐 아니라 수정 이력·저장 템플릿·기기 outbox의 과거 블록도 검토한 뒤 호환 코드를 제거한다. 현재 작업은 이 변환을 실행하지 않는다.

## 다음 AI 개선 작업의 진입점

- 사용자 다음 목표는 AI 활용 개선이다. 이번 분리 작업에서 AI 모델·실행기·프롬프트를 변경하거나 실호출하지 않는다.
- `/ai`와 `src/ai/AiActivity.tsx`는 처리 상태와 결과 접근, `src/prompts/`는 템플릿과 요청 미리보기, `src/pages/PageAiPanel.tsx`는 문서 대상 요청/명시 결과 반영을 맡는다.
- `server/ai/`·`shared/aiRequests.ts`·`shared/prompts.ts`와 CURRENT_IMPLEMENTATION의 실제 실행 규격을 먼저 확인한다.
- 사용자 관심: 어떤 템플릿/입력으로 요청했는지 확인하기, 결과를 읽기 쉽게 보여주기, 메모·문서·결과의 흐름 정리, Hive API 활용. 실제 개선 범위는 다음 대화에서 정한다.
- 원본 저장과 AI 실행을 분리하고 불변 요청/템플릿 사본·UUID 재시도·충돌 초안·명시 결과 반영을 유지한다. 외부 AI 비용 테스트는 로컬 fixture 검증과 구분한다.

## 이번 검증

전체 테스트 412/412, 타입 검사/빌드, 문서 작성 흐름 Chrome QA와 기존 일정·공유 Chrome QA가 통과했다. 새 메뉴 제외·회의 템플릿 생성·기존 4일 일정 표시·320/390px·오프라인 생성 후 동기화·공유의 개인 API 격리를 확인했다. 빌드에는 기존 대형 번들 경고가 남는다. 호환 코드를 유지하므로 지도 관련 코드 전체가 번들에서 제거된 것은 아니다. [검증 기록](../../.omo/evidence/travel-extraction/REPORT.md)에 명령과 범위를 남겼다.

## 후속 정리: 실제 작업 공간에서 여행 예시 제거

2026-10-05 사용자 요청에 따라 보관한 여행 예시 10개를 API의 휴지통 기능으로 이동했다. 일반 메모 자식 `d66fe2c0-3e4e-46c2-9077-7a3a8d5cacb0`는 먼저 루트로 옮겨 보존했다. 여행 관련 할 일은 별도 사용자 기록이므로 변경하지 않았다.

- 변경 직전 백업: `backups/pre-travel-cleanup-20261005` (생성·검증 성공, 첨부 14개).
- API 처리 내역: 위 백업의 `cleanup-receipts.json`.
- 원래 여행 보관본·소스는 앞의 추출 디렉터리에 유지한다. 휴지통은 복구 경로이며 활성 페이지 목록과 기존 개인 페이지 URL에서는 제거됐다.
- 문서 작성 모음: `6bc958ab-d075-4064-be76-2c1b1f424aa3`.
- 새 기능 안내: `dc41b4fc-686c-4d8f-a804-3c5a02a5599e`, 원문 `docs/DOCUMENT_AUTHORING_GUIDE.md`.
- 새 비여행 예시: `78935704-ebb3-4cf3-a6d3-38e21937f0e6`, 재사용 사본 `examples/weekly-sharing-sample.json`.
- 기존 리서치·회의·개발 예시 3개는 유지했다. 지도·일정 구문 호환은 과거 백업·이력 복구를 위해 남겨 두었다.
