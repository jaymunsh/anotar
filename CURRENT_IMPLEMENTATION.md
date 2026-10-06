# 현재 구현 규격

기준일: 2026-09-30. 이 문서는 **지금 실행되는 입력함·메모 정리 완료와 복귀·통합검색·블록 페이지·휴지통·할 일·프롬프트 관리·선택적 메모/페이지 AI·요청 모니터·일정과 지도·페이지 도구·수정 이력·자동 백업·로컬 읽기 전용 공유**의 동작을 기록한다. [기술 아키텍처](TECH_ARCHITECTURE.md)는 미니PC 운영과 방문자 댓글까지 포함한 목표 설계이며, 아직 구현되지 않은 기능도 담고 있다.

## 실행 구성

```text
브라우저 (React 19 + TypeScript + Vite 6)
  ├─ 개발: Vite 127.0.0.1:5173 ── /api 프록시 ──┐
  └─ 배포: Node 서버가 dist/ 제공 ───────────────┤
                                                ▼
                              Node 24 HTTP API (server/index.mjs)
                                ├─ SQLite (data/storage.sqlite)
                                └─ 원본 파일 (data/blobs/)
```

- [src/main.tsx](src/main.tsx): 입력·목록·검색·상세·모바일 입력 시트와 공통 사이드바·모바일 메뉴 줄. 홈의 배치와 작은 입력 카드 스타일은 [src/dashboard/dashboard.css](src/dashboard/dashboard.css)에 둔다. 모든 개인 화면에 PC 44px·모바일 48px sticky `workspace-topbar`와 하나의 `workspace-toolbar-slot`을 제공한다. `src/workspace/WorkspaceToolbar.tsx`의 context/portal로 각 화면이 소유한 제목·도구를 표시하며 문서에서는 기존 `document-topbar`/`toolbarTarget` 경로를 유지한다. 메모 검색은 모바일에서 펼치고 동일한 입력 노드를 유지한다. 필터·탭은 본문에 두며 반복되는 큰 관리 제목은 제거한다. 한국 날짜는 로고와 같은 줄 오른쪽 끝에 표시한다. 화면 모드는 하단 프로필의 설정 버튼으로 여는 `src/settings/WorkspaceSettings.tsx`의 작은 네이티브 dialog 안에서 해·달 아이콘 버튼으로 전환한다. URL 상태로 가운데 작업 영역만 전환하므로 입력 중인 초안은 남는다. `src/style.css`와 [src/theme-dark.css](src/theme-dark.css)가 밝은·어두운 화면을, [src/time.ts](src/time.ts)가 한국 날짜·시간 표시와 `NEW` 판정을 맡는다.
- [src/memos/CaptureCollection.tsx](src/memos/CaptureCollection.tsx)는 홈의 정리 전 메모 최근 3개와 `/memo` 전체 관리를 공유한다. **보관한 메모**와 **AI 요청**은 별도 탭이고 AI 탭 주소는 `/memo?view=ai`다. 종류 필터·검색·상세 수정과 **입력함 / 정리 완료**별 개수를 제공한다. 탭·정리 상태를 바꿀 때 이전 범위의 항목을 표시하지 않는다.
- [src/search/SearchPalette.tsx](src/search/SearchPalette.tsx)·`api.ts`·`types.ts`·`search.css`: 모든 화면의 사이드바 검색·`⌘K`·`Ctrl+K`가 여는 지연 로딩 통합검색. 페이지 편집기·Mermaid를 검색 의존성으로 불러오지 않는다. 이전 `src/pages/PageSearchPalette.tsx`는 이 컴포넌트를 다시 내보내는 호환 진입점이다.
- [src/pages/PageWorkspace.tsx](src/pages/PageWorkspace.tsx)는 입력함의 사이드바와 홈 최근 페이지에 같은 목록 메타데이터를 사용하고, `/pages/:id` 편집 내용을 가운데 작업 영역에 제공한다. 별도 페이지 목록 화면은 없으며 이전 `/pages`·`/temp` 주소는 `/memo`로 연결한다. 기존 `임시 정리` 페이지는 일반 문서로 보존하고 자동 생성하지 않는다. [src/pages/PageEditor.tsx](src/pages/PageEditor.tsx)는 BlockNote와 Mermaid를 페이지를 열 때만 불러온다. 편집기 소유의 경로·저장 상태·문서 도구는 `toolbarTarget`에 React portal로 표시한다. 본문 편집기를 다시 만들지 않고, 모바일의 기존 상단 줄과 하나로 합친다. 공유 설정은 고정 패널로 열려 스크롤 중에도 보인다.
- 서비스 표기는 `leneu.`이며, 사이드바 하단의 작은 프로필 이미지는 원본을 화면 크기에 맞게 줄인 [public/profile.png](public/profile.png)를 사용한다. 브라우저 탭 아이콘은 [public/favicon.png](public/favicon.png)다.
- [server/index.mjs](server/index.mjs): HTTP 경로, 업로드 스트리밍, 파일 응답, 정적 빌드 제공.
- [server/store.mjs](server/store.mjs): Node 내장 `node:sqlite`를 이용한 DB 생성과 조회. WAL 및 외래 키를 켠다.
- [server/search.mjs](server/search.mjs)·[server/searchText.mjs](server/searchText.mjs): 같은 DB의 FTS5·파생 평문·변경 번호·커서와 정규화·블록 평문 추출·순수 SQL 함수를 맡는다.
- [src/tasks/TaskWorkspace.tsx](src/tasks/TaskWorkspace.tsx)와 [server/tasks.mjs](server/tasks.mjs): 홈·`/tasks`의 할 일 UI와 독립적인 SQLite 저장·검증. 새 의존성을 추가하지 않는다.
- [src/prompts/usePromptLibrary.ts](src/prompts/usePromptLibrary.ts)와 [server/prompts.mjs](server/prompts.mjs): 지연 조회하는 템플릿 API·SQLite 저장·불변 수정본. [shared/prompts.ts](shared/prompts.ts)는 서버/브라우저의 변수·검증·기본값이다.
- [server/ai/jobs.mjs](server/ai/jobs.mjs)·[worker.mjs](server/ai/worker.mjs)·[research.mjs](server/ai/research.mjs)·[runner.mjs](server/ai/runner.mjs)·[devin.mjs](server/ai/devin.mjs): 같은 DB의 작업·제출 기록, 단일 비동기 작업자, 공개 URL 수집, HTTP 게이트웨이·Devin 실행기. [src/ai/AiJobPanel.tsx](src/ai/AiJobPanel.tsx)·[AiListUpdates.tsx](src/ai/AiListUpdates.tsx)는 지연 상세·가시 목록 상태를, [src/drafts/captureSubmission.ts](src/drafts/captureSubmission.ts)는 제출 UUID·선택 사본·파일 해시를 맡는다.
- [src/ai/AiActivity.tsx](src/ai/AiActivity.tsx)·[activity.css](src/ai/activity.css)는 지연 로딩한 홈 AI 현황·`/ai` 모니터와 가시 영역 폴링을, [api.ts](src/ai/api.ts)·[types.ts](src/ai/types.ts)는 요약 조회·정확한 작업 링크를 맡는다. `server/ai/jobs.mjs`의 `listAiActivity`는 기존 작업 테이블의 읽기 전용 집계다.
- [server/pageConnections.mjs](server/pageConnections.mjs)·[src/memos/CaptureOrganization.tsx](src/memos/CaptureOrganization.tsx)·[src/pages/PageOrigins.tsx](src/pages/PageOrigins.tsx)는 메모 정리 완료·입력함 복귀와 페이지 정보의 원본 출처를 맡는다. [shared/pageDocuments.ts](shared/pageDocuments.ts)는 기존 원본 블록을 숨기고 편집 후에도 저장 JSON을 보존한다. [server/pageMarkdown.mjs](server/pageMarkdown.mjs)·[shared/pageMarkdown.ts](shared/pageMarkdown.ts)는 저장된 Page의 제한된 입력과 동일한 미리보기를 순수 함수로 만들고 [server/pageAi.mjs](server/pageAi.mjs)는 명시적 결과 반영·직전 수정본·되돌리기 영수증을 맡는다. [src/pages/PageAiPanel.tsx](src/pages/PageAiPanel.tsx)는 지연 요청·이력·결과·반영 도구이며 [src/ai/pageSubmission.ts](src/ai/pageSubmission.ts)는 페이지별 UUID·최초 제출 본문을 보존한다.
- [shared/itinerary.ts](shared/itinerary.ts)·[itineraryPreview.ts](shared/itineraryPreview.ts)·[ItineraryBlock.tsx](src/pages/ItineraryBlock.tsx)는 활동·시간·겹침·방문 번호·이미지 공유를 맡는다. [ItineraryMap.tsx](src/pages/ItineraryMap.tsx)·[googleItinerary.mjs](shared/googleItinerary.mjs)는 개인 Google SDK 지연 로딩·번호/화살표·선택을 제공한다. [PlanImagePicker.tsx](src/pages/PlanImagePicker.tsx)는 첨부 이미지 선택, [ItineraryPreview.tsx](src/pages/ItineraryPreview.tsx)는 등록 이미지와 자체 방문 순서 이미지를 표시한다. 공개는 정적 이미지·외부 링크만 제공한다.
- [server/pageTools.mjs](server/pageTools.mjs)·[src/pages/PageToolsPanel.tsx](src/pages/PageToolsPanel.tsx): 단일 페이지 복제·사용자 페이지 템플릿·선택 블록 이동·직접 첨부·수정 이력과 UUID 재전송.
- [server/automaticBackups.mjs](server/automaticBackups.mjs)·[server/backupRoutes.mjs](server/backupRoutes.mjs)·[src/backups/BackupWorkspace.tsx](src/backups/BackupWorkspace.tsx): 개인 `/backups` 설정·상태·수동 실행과 한국시간 일일 예약.
- [vite.config.ts](vite.config.ts): 개발용 `/api` 프록시. [Dockerfile](Dockerfile)과 [compose.yaml](compose.yaml)은 같은 이미지를 개인·공유 명령으로 나눠 서로 다른 로컬 루프백 포트에 띄운다.

`npm run dev`는 Vite와 개인 API를 실행하고 서버 코드 변경 때 API 프로세스를 감시·재시작한다. 공개 링크는 별도 `npm run start:public` 서버(기본 `127.0.0.1:8790`)가 제공한다. `npm run build && npm start`는 개인 화면/API/AI 작업자를 제공하고 Compose는 같은 이미지의 개인·공유 명령을 별도 프로세스로 실행한다. 공유 서버는 DB를 읽기 전용으로 열며 개인 API·검색·업로드·AI 경로를 등록하지 않는다. DB·파일은 이미지 밖의 `data/`에 두고 기본 Docker 이미지는 Devin CLI·인증을 포함하지 않는다.

## 홈 대시보드

- PC 홈은 짧은 소개 아래 주 열에 빠른 입력·정리 전 일반 메모 최근 3개·최근 페이지 4개, 보조 열에 할 일·AI 현황을 둔다. 본문 최대 폭은 1160px이며 보조 열은 304px이다. 최근 메모는 하나의 목록으로 묶고 소개 옆 검색 버튼은 통합 검색을 연다. 1101px 이상에서는 첫 제목 32px·모듈 간격 16px과 낮은 입력·목록 행으로 화면 밀도를 높인다. 입력 본문은 최소 56px에서 세로로 늘릴 수 있다. 1100px 이하에서는 입력·AI 현황·할 일·메모·페이지 순서의 한 열이다. [화면 brief](.impeccable/briefs/home-dashboard.md)에 배치를 기록했다.
- 모바일 홈은 메모·URL·이미지·파일을 작은 인라인 입력 카드에서 바로 작성한다. **크게 쓰기**로만 전체 화면 작성 화면을 연다. 홈의 하단 기록 도크는 숨기고 다른 경로의 공통 도크는 유지한다. 일반 저장 버튼은 **저장**, AI 선택 시에는 **저장하고 AI 요청**이며 기존 초안·첨부·제출 동작을 공유한다.
- 최근 페이지는 `PageWorkspace`의 `/api/pages` 목록 메타데이터에서 수정 시각순 최대 4개를 선택해 제목·아이콘·한국 수정 시각을 표시한다. 처음 홈을 열 때 페이지 단건 문서·편집기·Mermaid를 요청하거나 불러오지 않는다. 로딩·빈 목록·오류 재시도와 **새 페이지 만들기**를 같은 영역에 둔다.

## 화면 정돈 (2026-09-30)

사이드바는 작은 로고·날짜와 하단 프로필·설정 버튼만 고정한다. 프롬프트·백업·휴지통은 설정 모달의 작업 공간 항목에서 연다. 큰 나의 공간 카드와 작업 공간 소제목을 없애고 기본 메뉴·즐겨찾기·내 페이지가 화면 높이와 관계없이 하나의 영역에서 스크롤한다. 스크롤 끝에서 휠 입력이 본문으로 넘어가지 않게 하고 목록 스크롤바는 사이드바 오른쪽 끝에 붙이고 목록 바깥 8px 여백과 스크롤바 공간을 유지해 가로 위치를 고정한다. PC의 마우스 환경에서는 기본 메뉴·즐겨찾기·페이지 행을 28px로 맞추고 섹션 간격을 줄인다. 모바일 페이지·즐겨찾기 조작 영역은 기존 44px를 유지한다. 메모·할 일·AI·프롬프트·휴지통은 최대 1120px 폭과 공통 제목·여백을 쓴다. 페이지 주요 도구는 공유·댓글·AI·더보기다. 되돌리기·Mermaid·Markdown·출처·휴지통은 더보기로 옮겼다. 메뉴 하단 안내와 출처는 페이지 정보·도움말로 접어두며 펼칠 때만 원본 메모를 조회한다. **넓게 보기**·**작은 글씨**는 브라우저 설정에 저장한다. **목차 열기**는 현재 제목 블록을 따라 갱신되는 패널이다. AI·목차는 PC 오른쪽 패널·좁은 화면 하단 패널이며 한 번에 하나를 연다. 지도 좌표 입력은 **위치 수정**으로 펼친다. 저장·공유·AI 실행 계약을 유지하며 개인 댓글은 별도 저장 계약을 사용한다.

빌드 후 `node scripts/qa-workspace-ui.mjs`로 임시 DB·비활성 AI 검증을 수행한다. `QA_WORKSPACE_SCREENSHOTS=1`은 `.impeccable/review/workspace-ui/`에 화면을 기록한다.

## 데이터 규격

| 테이블                            | 현재 필드                                                                                                                                                                                                                                                                                   | 의미                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `captures`                        | `id`, `kind`, `text`, `url`, `created_at`, `updated_at`, `version`, `ai_request`, `sample_key`, `deleted_at`, `trash_id`, `organized_at`, `organized_page_id`, `organized_operation_id`                                                                                                     | 제목 없는 원본. 선택적 불변 요청문·예시 키·휴지통 상태와 정리 완료 일시·페이지·최초 정리 작업 ID. 정리 전 세 필드는 `null`     |
| `assets`                          | `id`, `capture_id`, `page_id`, `storage_key`, `name`, `mime`, `size`                                                                                                                                                                                                                        | Capture 또는 Page 중 정확히 하나가 소유하는 첨부. 직접 페이지 첨부는 `capture_id: null`이며 난수 저장 키를 사용                |
| `pages`                           | `id`, `title`, `icon`, `parent_id`, `position`, `document`, `version`, `created_at`, `updated_at`, `deleted_at`, `trash_id`                                                                                                                                                                 | 페이지 제목과 `schemaVersion: 1`의 블록 JSON. 버전을 비교해 늦은 저장을 거절                                                   |
| `tasks`                           | `id`, `title`, `status`, `in_progress`, `due_date`, `position`, `created_at`, `updated_at`, `completed_at`, `version`, `create_request_id`, `create_payload`                                                                                                                                               | 독립 할 일. 수정 버전과 추가 요청 UUID·최초 내용을 보존해 충돌·중복 재시도를 검사                                              |
| `prompt_templates`                | `id`, `name`, `description`, `kind`, `body`, `archived`, `version`, `revision_id`, `create_payload`, `created_at`, `updated_at`                                                                                                                                                             | 현재 템플릿·최초 생성 내용. 기존 DB 연결 공유                                                                                  |
| `prompt_revisions`                | `id`, `template_id`, `version`, `name`, `description`, `kind`, `body`, `archived`, `created_at`                                                                                                                                                                                             | 저장·보관·꺼내기마다 추가하는 불변 수정본                                                                                      |
| `prompt_imports`                  | `source_id`, `content_hash`, `target_id`, `target_version`, `target_revision_id`                                                                                                                                                                                                            | 원본과 최초 가져오기 시점의 대상 수정본. 재시도 중복·초안 충돌 방지                                                            |
| `prompt_meta`                     | `key`, `value`                                                                                                                                                                                                                                                                              | 저장소 UUID `library_id`. 기본값은 최초 초기화 때만 생성                                                                       |
| `capture_submissions`             | `request_id`, `fingerprint`, `capture_id`, `created_at`                                                                                                                                                                                                                                     | Capture 제출 UUID·입력 지문·최초 원본. 응답 유실 재제출의 중복 저장 방지                                                       |
| `ai_jobs`                         | `id`, `request_id`, `fingerprint`, `capture_id`, `page_id`, `source_version`, `source_document`, `source_title`, `target_block_ids`, `request_json`, `retry_of`, `status`, `run_token`, `runner_json`, `result_json`, `error_code`, `created_at`, `updated_at`, `started_at`, `finished_at` | Capture 또는 Page 한 소유자의 불변 요청·입력 버전. Page는 저장 문서·제목·선택 블록도 보존. 실행 토큰은 내부 완료 검사에만 사용 |
| `page_references`                 | `page_id`, `block_id`, `target_type`, `target_id`                                                                                                                                                                                                                                           | 본문 안 capture·asset·page 참조의 파생 색인                                                                                    |
| `page_import_operations`          | `operation_id`, `request`, `result`, `created_at`                                                                                                                                                                                                                                           | 가져오기 UUID·최초 요청·최초 응답. 기존 영수증도 보존                                                                          |
| `page_origins`                    | `operation_id`, `page_id`, `capture_id`, `job_id`, `created_at`                                                                                                                                                                                                                             | 본문 밖의 원본 메모·선택한 완료 작업 출처. `job_id`는 선택적                                                                   |
| `capture_organization_operations` | `operation_id`, `request`, `result`, `created_at`                                                                                                                                                                                                                                           | 입력함 복귀의 최초 정리 작업 기준·UUID·영수증                                                                                  |
| `page_ai_revisions`               | `operation_id`, `page_id`, `prior_version`, `title`, `document`, `applied_version`                                                                                                                                                                                                          | AI 추가·교체 직전 저장 문서·제목과 반영 버전. 일반 편집 이력이 아님                                                            |
| `page_ai_applies`                 | `operation_id`, `page_id`, `fingerprint`, `request`, `result`, `created_at`                                                                                                                                                                                                                 | AI 결과 반영 UUID·최초 요청·최초 응답                                                                                          |
| `page_ai_undos`                   | `operation_id`, `apply_operation_id`, `fingerprint`, `result`, `created_at`                                                                                                                                                                                                                 | 특정 AI 반영을 되돌린 UUID·요청 지문·최초 응답                                                                                 |
| `search_documents`                | `row_id`, `target_kind`, `target_id`, `category`, `title`, `body`, `url`, `icon`, `kind`, `created_at`, `updated_at`                                                                                                                                                                        | 원본에서 만드는 평문·결과 메타데이터. `(target_kind, target_id)`는 유일하며 원본 ID·본문의 기준 저장소가 아님                  |
| `search_fts`                      | `title`, `body`, `url`, `category`, `characters`                                                                                                                                                                                                                                            | 위치를 유지한 인코딩 두 글자 토큰·분류·고유 문자 열. `content=''`, `contentless_delete=1`의 FTS5                               |
| `search_state`                    | `id`, `revision`                                                                                                                                                                                                                                                                            | 검색 변경 번호. 원본 쓰기 트랜잭션의 트리거로 갱신                                                                             |
| `search_meta`                     | `id`, `version`                                                                                                                                                                                                                                                                             | 파생 검색 스키마 v3. 최초 이관·명시 재구축을 구분하고 정상 재시작의 전체 재색인을 막음                                         |

페이지 도구는 같은 DB에 다음 자료를 추가한다.

| 테이블                 | 저장하는 값                                                     | 용도                                                         |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `page_tool_operations` | `operation_id`, `request`, `result`, `created_at`               | 복제·템플릿 저장/생성·이동·첨부·복원의 UUID와 최초 요청/응답 |
| `page_templates`       | `id`, `name`, `title`, `icon`, `document`, `created_at`         | 저장 당시 문서 사본. 프롬프트 템플릿과 별개                  |
| `page_template_assets` | `template_id`, `asset_id`                                       | 템플릿의 개인 첨부 보존 참조                                 |
| `page_revisions`       | `page_id`, `version`, `title`, `icon`, `document`, `created_at` | 페이지별 최신 100개 불변 수정본                              |
| `page_revision_assets` | `page_id`, `version`, `asset_id`                                | 남아 있는 수정본의 개인 첨부 보존 참조                       |

기존 자산 이관은 `assets`의 ID·rowid·저장 키·Capture 소유권을 보존하고 `page_id`와 소유자 XOR 제약을 추가한다. 기존 페이지의 현재 버전을 최초 한 번 수정본으로 기록하며 과거 이력을 만들어 내지 않는다. 파일 바이트·원본 문서·메모를 초기화하지 않는다.

`page_roles`는 `role`, `page_id`로 이전 `staging` 역할과 예시 페이지의 안정적인 ID(`sample.*`)를 저장한다. 이전 임시 문서 API는 호환을 위해 남아 있지만 현재 UI는 호출하거나 특별한 진입 링크를 만들지 않는다. 예시 페이지는 이름·위치·본문을 바꾸어도 샘플 스크립트 재실행으로 초기화되지 않는다. 입력함·메모 목록 조회만으로 문서를 생성하지 않는다.

파일 본문은 SQLite에 넣지 않는다. 캡처·파일 메타데이터와 선택적 AI 작업·제출 기록은 한 DB 트랜잭션에서 등록한다. 업로드 또는 DB 등록에 실패하면 해당 요청에서 쓴 파일을 지운다. 제출 중복 판정에는 순서가 있는 파일 바이트의 SHA256을 사용한다. 자산 열에는 영구 체크섬을 저장하지 않으며 백업 생성·검증 때 DB와 첨부의 크기·SHA256·무결성을 확인한다. 자동 백업은 같은 검증 도구를 사용한다.

현재 `Capture`에는 별도 제목 필드가 없다. 메모 목록은 원문을 한 줄로 미리 보고 넘치는 부분은 말줄임표로 표시하며, 상세는 원문 전체를 한 번만 표시한다. 첫 줄을 제목으로 추론하거나 상세에서 반복하지 않는다.

홈 최근 메모와 `/memo`의 조회 오류는 입력 폼의 저장 오류와 분리한 `listError`로 표시한다. 빈 응답·JSON이 아닌 응답·조회 실패에는 목록 자리에 한국어 안내와 **다시 불러오기**를 보여주며 로딩 표시를 끝낸다. 다시 조회해도 작성 중인 메모와 AI 설정은 유지한다. Task도 빈 응답·JSON이 아닌 응답을 한국어 오류로 처리하고 **목록 다시 불러오기**를 제공한다.

AI 요청의 `aiRequest`는 `schemaVersion: 1`, `status: prepared`, 당시 템플릿 사본(ID·이름·본문·종류·버전·수정본 ID), 추가 조건, 입력 텍스트·URL, 조립 요청문을 담는다. 이 `prepared`는 불변 요청 사본의 형식이며 실제 실행 상태는 별도의 `ai_jobs`에 있다. 새 AI 저장은 같은 트랜잭션에서 작업을 등록하고, 이전 요청·예시 요청은 작업 없이 유지한다. 템플릿이나 Capture를 수정해도 요청 사본은 그대로 남는다. 목록·상세에는 현재 원본과 요청 당시 사본을 구분하고 최신 작업 요약 `latestAiJob`을 제공한다.

보관한 항목의 상세에서 **항목 수정**을 누르면 메모 내용, 링크 주소·설명, 이미지·파일 설명을 고칠 수 있다. 수정은 명시적으로 **변경 저장**을 눌러 반영하며 첨부 파일 자체와 생성 시각은 그대로 둔다. 다른 탭에서 먼저 고쳤다면 409를 보여주고 작성 중인 초안을 유지한다. **최신 내용 불러오기**를 고르면 그때 서버 버전으로 편집 내용을 교체한다. 기존 입력에는 시작 시 `version: 1`과 생성 시각과 같은 `updatedAt`을 채운다. 메모 상세는 유형 아래에 생성일·최종 수정일을 항상 표시한다. 편집 전에는 두 일시가 같다.

페이지는 열자마자 직접 편집할 수 있고 제목에서 Enter를 누르면 본문으로 이동한다. 편집기는 앱의 화면 모드에 맞춰 밝은·어두운 테마로 표시한다. 기본 화면 모드는 운영체제 설정을 따르며 하단 프로필에서 연 설정 모달의 해·달 아이콘 버튼을 클릭해 전환한다. 별도의 시스템 선택 항목은 표시하지 않는다. 직접 선택하기 전에는 저장값 없이 시스템 변경을 따라가고, 설정에서 직접 고른 밝음·어두움 값은 이 브라우저의 `localStorage`(`leneu:theme`)에 저장한다. 초기 화면 색은 HTML에서 먼저 적용해 테마 전환 깜박임을 줄인다. Mermaid 미리보기도 어두운 화면에서 도형·글자·연결선 대비를 맞춘다. 문단, 제목 1~6, 접을 수 있는 제목, 글머리·번호·체크·접을 수 있는 목록, 인용, 코드, 구분선, 표, Mermaid 다이어그램, 목차, 페이지 링크 블록을 지원한다. `/` 메뉴에서 고르거나 입력 단축키로 만든다. 빈 문단에서 `>`는 접을 수 있는 목록, `"`는 인용으로 바뀐다. 붙여넣은 Markdown의 `>` 문단은 그대로 인용이 된다. `:` 입력 또는 메뉴의 이모지 항목으로 이모지를 넣는다. 어느 블록이든 `Tab`/`Shift+Tab` 또는 드래그 손잡이 메뉴의 들여쓰기·내어쓰기로 다른 블록 안쪽에 둘 수 있고, 접을 수 있는 블록은 자식을 펴고 접는다. 왼쪽의 점 6개 손잡이를 눌러 메뉴를 열면 해당 블록 영역 전체가 옅은 녹색으로 강조되고, 메뉴가 닫히면 해제된다. 목차 블록은 연한 배경 영역 안에 페이지의 제목을 자동으로 모아 보여주고 항목을 누르면 그 제목으로 이동한다. `/` 메뉴의 페이지 항목은 새 하위 페이지를 만들고 링크 블록을 넣으며, 링크를 누르면 같은 앱에서 그 페이지가 열린다. 링크 블록은 대상 페이지의 현재 제목과 대표 이모지를 다시 조회해 보여주고, 대상이 없으면 '페이지를 찾을 수 없어요'로 표시하며 이동·복원 뒤 참조를 다시 조회한다. 제목 위의 아이콘 버튼(없을 때는 마우스를 올리면 나타나는 '아이콘 추가')에서 페이지 대표 이모지를 고르거나 지울 수 있고, 선택 패널은 emoji-mart 전체 목록을 카테고리·검색과 함께 세로 스크롤로 보여준다. 문서 위에는 상위 페이지 경로(`parentId`를 따라 만든 아이콘·제목 목록, 누르면 이동, 4단계 이상이면 가운데를 `…`로 줄임), 저장 상태와 작은 아이콘 도구를 둔다. 생성일·최종 수정일은 제목 아래에 항상 표시하고, 입력 도움말은 **페이지 정보** 메뉴를 열면 보인다. 최종 수정일은 성공한 저장 응답의 `updatedAt`으로 갱신하며 미저장 초안·저장 실패 시 앞당기지 않는다. 데스크톱 문서는 최대 960px 폭이며 모바일에는 48px 메뉴 줄을 유지한다. 이모지는 사이드바·페이지 목록·해당 페이지를 가리키는 링크 블록에 함께 표시된다. 하위 페이지는 `parentId`를 저장해 사이드바에서 상위 아래에 들여져 보인다. 사이드바 목록은 `position`으로 정렬하며, 새 페이지는 같은 단계의 끝에 붙어 기본적으로 만든 순서를 따른다. 행을 드래그해 위·아래 경계에 놓으면 같은 단계에서 순서를 바꾸고, 행 한가운데나 목록 끝 빈 영역에 놓으면 하위로 넣거나 최상위로 뺀다. 경계 드롭 위치는 파란 실선, 안쪽 드롭은 옅은 파란 배경으로 표시한다. 자기 자신이나 자손 안으로는 옮길 수 없다. 하위가 있는 행은 화살표로 접고 펼 수 있고 접은 상태는 이 기기에 남는다. 하위가 없는 잎 행도 화살표를 펼치면 '하위 페이지 없음'을 보여준다. 모든 화면의 사이드바 **검색**·`⌘K`·`Ctrl+K`는 메모·AI 요청·페이지 제목과 본문·파일명을 찾는 통합검색을 연다. 방향키·Enter·마우스로 기록을 열 수 있다. 자세한 검색 의미와 남은 조합 입력 제한은 아래 **통합검색** 절을 따른다. 편집한 내용은 `⌘Z`·`⇧⌘Z` 또는 위쪽 되돌리기·다시 실행 버튼으로 되돌리며, 되돌릴 내용이 없으면 버튼이 비활성이다. Markdown 보기·복사는 `includeAppReferences: true`로 첨부의 앱 전용 ID와 하위 페이지 링크(`/pages/:id`)를 포함하고 목차·원본 메모 카드·출처는 제외한다. AI 입력의 기본 Markdown 변환은 앱 전용 참조를 제외하며 어느 변환도 참조 대상 본문이나 파일 바이트를 가져오지 않는다. Markdown 입력 단축키와 일반 Markdown·서식 있는 HTML 붙여넣기를 블록으로 변환한다. ` ```mermaid ` 코드 울타리는 다이어그램 블록으로 저장되고 Markdown 보기·복사에도 포함된다. 페이지 원본은 Markdown이 아닌 블록 JSON이다. 750ms 입력 대기 후 자동 저장하며, 브라우저의 미저장 초안을 복원·복사할 수 있다. 공유 화면은 별도 읽기 전용 서버에서 제공한다. 문법 범위는 [Markdown 사용 안내](MARKDOWN_GUIDE.md)에 정리했다.

### 개인 블록 댓글

개인 페이지 상단의 **댓글**은 저장된 블록에 연결된 대화다. 댓글 모드에서는 문서 편집을 잠그고 블록 옆 표시·PC 오른쪽 패널·모바일 하단 패널에서 댓글, 답글, 해결/다시 열기, 삭제를 관리한다. 원본 문서 버전과 수정 시각은 바뀌지 않는다. 서버 SQLite에 저장하며 새로고침 후에도 유지한다. 입력 중인 댓글과 미확인 제출 사본은 브라우저 세션에 보존하고 같은 UUID 재전송은 최초 응답을 돌려준다.

저장된 본문을 편집하는 중에도 블록 옆 말풍선으로 대화를 바로 연다. 기존 대화는 실제 댓글 수·해결 상태를 표시한다. 편집 화면에서는 `GET /api/pages/:id/comments?view=summary`로 본문 없는 개수/상태만 조회하고 전체 대화는 패널을 열 때 읽는다. 댓글 패널이 열린 동안에는 기존 읽기 전용 문서 계약을 유지한다.

PC는 우측 340px 대화 패널, 모바일은 기본 62%·확장 88% 하단 패널이다. 인용과 본문 위치 버튼, 가운데 대화 스크롤, 하단 댓글/답글 입력을 분리한다. 입력은 Enter 줄바꿈·Ctrl/Cmd+Enter 등록이고 한글 조합 중 등록을 막는다. 해결하면 접힌 요약·펼치기·다시 열기를 제공한다. 삭제는 대화 더보기에서 확인 후 처리한다. 모바일 키보드의 visualViewport 변화에 맞춰 입력란을 유지하며 실제 iOS/Android 키보드 QA와 브라우저 크기 변화 검증은 구분한다.

블록이 없어지거나 이동하면 기존 블록 인용을 보존하고 위치 없음으로 표시한다. 페이지당 최대 500개 스레드·1,000개 댓글, 스레드당 100개 댓글, 댓글당 2,000자다. 개인 댓글은 비공개로 유지한다. **공유 댓글** 탭은 별도 공유 대화이며 아래 이름 기반 공유 댓글 규격을 따른다. 방문자 로그인·본인 확인·직접 수정/삭제·신고·외부 알림은 제공하지 않는다. 이전 [화면 시안 설계](docs/superpowers/specs/2026-09-30-block-comments-preview-design.md)는 당시 기록이며 현재 계약은 아래 배포 전 완성 항목을 따른다.

### 이름 기반 공유 댓글

**페이지 공유 → 방문자 댓글 허용**은 기본 꺼짐이며 기존 링크는 `PATCH /api/pages/:id/shares/:shareId`로 정책만 바꾼다. 발급/목록 DTO의 `commentsEnabled`는 bool이다. 공유 본문은 읽기 전용이고 개인 댓글은 자동 공개되지 않는다. 공유 댓글은 페이지 단위이며 같은 페이지의 새 링크에서도 이어진다.

공개 `GET/POST /s/:token/comments`는 매 요청에 만료/폐기/활성 페이지/허용을 확인한다. 방문자는 이름 1~30자와 1~2,000자 댓글 또는 답글만 남긴다. 이름은 인증되지 않은 표시 이름이며 같은 브라우저에 기억한다. 작성자 답글/해결/삭제는 개인 `GET/POST /api/pages/:id/shared-comments`에서 관리하고 서버가 `나`·`isOwner: true`를 고정한다. `?view=summary`는 개수/해결 상태만 반환한다. 개인/공유 탭의 초안과 UUID 제출 사본은 서로 분리한다. 개인·공유 패널의 **댓글 새로고침**은 현재 대화와 이름·초안을 유지하며 최신 답글을 조회한다. 다른 방문자가 같은 블록에 먼저 대화를 만들어도 첫 댓글 초안을 해당 대화로 복구하고 미확인 요청 UUID·본문은 바꾸지 않는다.

공유 댓글은 `shared_comment_threads`, `shared_comments`, `shared_comment_operations`에 저장되며 원본 문서의 version/수정일과 분리된다. 개인 SQLite 백업에 포함한다. 삭제되거나 비공개로 바뀐 블록의 대화는 개인 관리에서 보존하며 공개 조회/쓰기에서는 숨긴다. 공개 렌더링의 내부 페이지·원본 메모·목차와 자식은 댓글 대상이 아니다.

공유 프로세스는 DB와 첨부를 계속 읽기 전용으로 연다. `COMMENT_SOCKET_PATH`(기본 `DATA_DIR/share-comments.sock`)의 댓글 전용 Unix socket broker가 개인 프로세스에서 토큰과 입력을 다시 검사해 저장한다. 공개 JSON 요청은 8KiB·동일 Origin 검사, 제한된 요청 속도를 적용한다. 개인 API/AI/업로드/검색/백업 경로를 공개 서버에 등록하지 않는다. 공유 댓글 JS/CSS는 작은 독립 정적 파일이며 편집기/지도 SDK를 불러오지 않는다. 오프라인 ZIP에는 댓글 UI/대화를 포함하지 않는다.

### 읽기 전용 페이지 공유와 계획 지도

- **페이지 공유**는 1·7·30·90일/만료 없음, 재발급/폐기, 토큰 SHA-256 해시, 현재 페이지/첨부 범위 재검사를 유지한다. 개인 `GET/POST /api/pages/:id/shares`, `DELETE /api/pages/:id/shares/:shareId`, `GET /api/share-config`와 별도 공개 `GET/HEAD /s/:token`, `/s/:token/assets/:assetId`를 사용한다.
- 공유 HTML은 이스케이프한 읽기 전용 본문이다. 하위 페이지·원본 메모·개인 API·업로드·AI는 공개하지 않는다. 댓글은 링크의 방문자 댓글 허용을 켠 경우에만 별도 경로로 읽고 쓴다. Mermaid는 코드 텍스트다. 공개 CSP는 같은 출처의 JS/CSS/이미지/댓글 요청과 자체 SVG data 이미지만 허용하고 외부 지도 SDK·타일·iframe은 허용하지 않는다. `no-store`·`noindex`·`no-referrer`를 유지한다.
- **일정 수정**에 선택적 활동 유형(관광 `sightseeing`·이동 `travel`·식사 `meal`·휴식 `rest`·숙박 `stay`·기타 `other`)과 공유 이미지 선택을 추가했다. 기존 `version: 1` 자료·항목 ID·순서는 유지하며 유형을 추론해 채우지 않는다. 시간은 한국시간 날짜/시각이며 시작/끝에서 소요시간을 계산한다. 같은 날의 양의 시간 구간이 겹치면 안내하되 적용을 막지 않는다. 끝 없는 항목·0분 항목·맞닿는 시간은 겹침으로 표시하지 않는다.
- 이동은 장소 번호에서 제외한다. 유형이 지정됐으나 장소/좌표가 없는 활동도 제외한다. 이전 유형 없는 항목은 기존 번호를 유지하며 좌표 없는 방문은 번호에 남지만 지도 핀은 없다. 같은 날의 연속된 방문 번호만 선으로 연결하고 실제 도로 경로·이동 시간 계산으로 표현하지 않는다.
- `itinerary`·기존 `map` 블록의 선택적 `props.assetId`는 이미지 첨부 참조다. 페이지 **더보기 → 파일 첨부**로 올린 이미지를 선택/교체한다. PNG/JPEG/WebP/GIF/AVIF만 허용하며 새 참조는 개인 파일 접근과 MIME을 검사한다. 원본 메모 휴지통·복제·블록 이동·템플릿·수정 이력에서도 참조를 보존한다. 현재 본문에서 제거한 이미지는 공개되지 않는다.
- 공유는 선택한 이미지를 기본으로 보여주고 Google Maps 장소 링크를 제공한다. 이미지가 없으면 외부 지도 데이터 없이 좌표로 생성한 방문 위치·순서 SVG를 보여준다. 안내 문구로 실제 도로 지도와 구분한다. 이미지를 불러오지 못해도 시간표·링크는 유지된다. Google 지도를 자동 캡처하지 않는다. 기존 OSM iframe·타일·Leaflet 패키지와 공개 지도 SDK 경로는 제거했다. 기존 장소 좌표·이름·확대 값과 사용자 문서는 삭제하지 않는다.
- 일정 초안은 기존 키 `leneu:itinerary-draft:v1:<block.id>`에 이미지 선택과 저장 당시 이미지 ID도 함께 남기고 같은 원문/이미지 기준에서만 복구한다. 시간·제목·장소·설명·유형을 시간표에서 직접 수정하고 blur/Enter로 검증한 뒤 기존 Page 자동 저장에 반영한다. 설명은 Enter 줄바꿈·Ctrl/Cmd+Enter 확정, Escape 취소이며 IME 조합 중 확정하지 않는다. 이전/미확정 초안을 복구하면 **복구한 초안 적용**으로 명시 반영하며 그 전에는 원문을 바꾸지 않는다. Page 저장 충돌·실패 재시도 계약을 유지한다. Markdown 표에 활동·소요시간을 포함하고 명시적 내보내기에서 이미지의 앱 전용 ID를 보존한다. AI 변환은 이미지 ID/바이트를 제외한다.
- `npm run seed:activity-plan`은 **서울 하루 계획 · 관광과 이동**을 한 번 추가한다. 기존 페이지와 수정한 샘플을 덮지 않는다. `npm run qa:static-plan`은 임시 저장소/AI 비활성에서 활동·겹침·초안·이미지·공유·모바일을 확인한다. 현재 페이지와 직접 참조 첨부의 오프라인 읽기 ZIP을 제공한다. 전체 오프라인 편집/동기화와 실제 경로 계산은 아직 없다.

### Google 일정 지도

개인 화면의 **장소 지도 보기**에서만 Google SDK를 요청한다. `?map=google`은 지도 또는 키 입력을 연다. 수동 데모 키는 마스킹하고 탭의 `sessionStorage`에 남긴다. 개인 `GET /api/maps/config`가 선택적 `GOOGLE_MAPS_DEMO_KEY`를 제공하며 로컬 `.env`를 `npm run dev`·`npm start`가 읽는다. Compose는 개인 서비스에만 키를 전달한다. 공유 서버는 키를 사용/노출하지 않는다. 키는 브라우저 공개값이므로 사이트/API 제한을 설정하며 코드·문서·로그에 원문을 남기지 않는다.

개인 번호 핀·방향 화살표·전체 맞춤·시간표 선택과 키/인증/네트워크 오류 복구는 유지한다. 장소 검색·Routes API는 없다. 기존 `npm run seed:google-map`의 세 장소 문서는 보존한다. [사용 안내](SHARING_AND_PLANS.md#google-일정-지도)를 따른다. 과거 Google 공개 지도 QA는 이전 구현의 기록이며 현재 공유의 정적 이미지 검증과 구분한다.

### 페이지 도구와 수정 이력

페이지 **더보기**의 **페이지 복제 / 파일 첨부 / 템플릿 / 선택 블록 이동 / 수정 이력**을 사용한다. 템플릿·이동·이력은 기존 보조 패널을 공유하며 PC 오른쪽, 좁은 화면 하단에 열린다.

- **복제:** 현재 저장된 제목·아이콘·본문을 같은 상위 아래 새 페이지로 만들고 제목에 `(복사)`를 붙인다. 하위 페이지 트리는 복제하지 않으며 본문에 이미 있는 페이지 링크는 기존 대상을 가리킨다. 블록 ID는 새로 만들고 첨부 ID/바이트는 재사용한다.
- **페이지 템플릿:** 저장된 문서를 이름(1~160자)과 함께 사본으로 보관하고 선택한 상위 아래 새 페이지를 만든다. 템플릿 삭제는 이미 만든 페이지를 바꾸지 않는다. `/prompts`의 AI 프롬프트 템플릿·프롬프트 수정본 UI와 별개다.
- **직접 첨부:** 숨은 Capture 없이 Page가 소유하는 `asset` 블록을 본문 끝에 추가한다. 한 번에 8개·개별 25MB·합계 100MB이며 파일 순서·이름·MIME·크기·SHA256을 재전송 지문으로 사용한다. 실패·충돌·이미 처리된 UUID의 재전송에서 새로 업로드한 파일은 정리한다. 현재 첨부 블록을 공유 페이지에 두면 공유 범위에 포함된다.
- **선택 블록 이동:** 현재 문서에서 고른 블록을 다른 활성 페이지 끝으로 옮긴다. 선택 부모와 자식은 중복 이동하지 않고 새 블록 ID를 만든다. 원본 `expectedVersion`과 대상 `targetVersion`, 선택 ID와 UUID를 확인하며 두 문서의 한도·참조·저장을 한 트랜잭션에서 처리한다. 전체 블록을 옮겨도 원본에 빈 문단을 남긴다. 첨부 바이트는 복사하지 않는다.
- **이력:** 기존 문서 현재 버전의 최초 이관 뒤 생성·자동 저장·AI 반영·메모 가져오기·서버의 버전 변경을 DB 트리거로 기록한다. 페이지별 최근 100개 제목·아이콘·본문·기록 시각을 내림차순으로 조회하고 읽기 전용으로 확인한다. **이 수정본으로 복원**은 현재 `expectedVersion`을 검사해 제목·아이콘·본문을 새 버전으로 저장한다. 현재 `parentId`·`position`은 유지하며 원래 버전 번호로 돌아가지 않는다. AI 반영 직전의 제한된 되돌리기와 일반 수정 이력은 별도다.

복제·템플릿 저장/생성·이동·첨부·복원은 UUID `operationId`와 최초 요청을 보관한다. 같은 요청은 최초 응답에 `replayed: true`를 붙여 반환하고 같은 UUID의 다른 요청은 409다. 템플릿 삭제는 별도 `DELETE`다. 브라우저는 최초 제출 사본을 페이지별로 보존해 응답 유실·이동·새로고침 뒤 **같은 요청 다시 확인**으로 재전송한다. 직접 첨부 재전송에는 최초 파일의 재선택이 필요할 수 있으며 지문을 비교한다. 미저장·충돌·미해결 복구·변경 확인 대기 중에는 문서를 덮는 도구를 막고 오류·초안·선택을 유지한다.

현재 본문의 활성 참조 외에도 남아 있는 개인 수정본·페이지 템플릿은 파일 접근을 유지한다. 휴지통의 기록만 남으면 일반 파일 API는 차단하고 바이트를 복원용으로 보존한다. 파일명 통합검색은 활성 현재 소유자/본문 참조 범위이며 수정본·템플릿만의 파일은 검색에 넣지 않는다. 공개 파일 API는 **현재 공유 Page 본문의 직접 `asset`·`map`·`itinerary` 첨부 참조만** 허용하고 과거 수정본·템플릿의 파일을 노출하지 않는다. 전체 백업에는 등록된 첨부와 수정본·템플릿·작업 영수증이 함께 포함된다.

### 통합검색

사이드바 **검색**·`⌘K`·`Ctrl+K`는 어느 화면에서든 같은 검색창을 연다. **전체 / 메모 / 페이지 / 파일 / AI 요청 / AI 결과 / 할 일 / OCR** 필터를 제공하며, 메모에 제목을 추론하거나 현재 원문을 AI 사본으로 교체하지 않는다.

| 분류   | 색인하는 내용                                                                 | 결과 이동                                            |
| ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| `memo` | 현재 Capture 원문·URL                                                         | `/captures/:id`                                      |
| `ai`   | 현재 원문·URL, 보관 당시 입력·입력 URL·템플릿 이름·조립 요청문의 불변 사본    | `/captures/:id`, **실행 전** 표시                    |
| `page` | 제목, 문단·리스트·코드·Mermaid·표 셀·접힌 자식 블록의 작성 텍스트와 링크 주소 | `/pages/:id`, 현재 계층 경로                         |
| `file` | 첨부 파일명만                                                                 | 정리 전 활성 소유 Capture, 없으면 참조하는 활성 Page |

- 일정 블록은 제목·날짜·시간·일정·장소·메모·관련 URL을 평문으로 색인한다. 좌표·항목 ID·JSON 구조는 색인하지 않는다. 페이지 ID·스타일·참조 ID·참조 대상의 원문은 평문 색인에 섞지 않는다. 페이지에 실제 복사한 본문은 색인한다. 정리 완료 Capture·AI 요청은 검색 결과에서 제외한다. 첨부 파일명은 정리 전의 활성 소유 메모 또는 활성 참조 페이지가 있을 때만 결과에 나타난다. 정리 완료 소유 메모의 파일은 사용하는 활성 Page로 이동하며 활성 사용처가 없으면 검색에서 제외한다. 파일 원본과 개인 파일 API의 활성 소유자 접근은 유지한다.
- 질의는 최대 **160 UTF-16 코드 단위·공백으로 나눈 12단어**다. NFC·소문자화·연속 공백 정리를 적용한다. 모든 단어를 포함해야 하며 한 단어는 같은 필드 안에서 연속해야 한다. `%`, `_`, 따옴표, `AND`, 이모지는 리터럴 글자다.
- 두 코드 포인트 이상인 단어 하나가 필요하다. 한 글자만 있으면 `reason: short_query`와 빈 결과를 반환한다. `교토 3`의 한 글자 조건은 같은 FTS의 고유 문자 열에서 확인한다. 두 글자 이상 단어는 코드 포인트 기반 ASCII 두 글자 토큰의 위치를 유지한 구문 검색으로 찾으므로 떨어진 문자 쌍이나 제목/본문/URL 경계를 넘는 가짜 일치를 만들지 않는다.
- 빈 질의는 최근 활성 기록을 수정일·내부 행 ID 내림차순으로 **20개씩** 반환한다. 본문 검색은 FTS5 BM25 제목/파일명 **10**·URL **3**·본문 **1**, 동점은 내부 행 ID 내림차순이다. 최대 20개를 반환하고 21개 조회로 다음 페이지 유무를 판단하며 매 입력마다 전체 개수를 집계하지 않는다.
- 커서는 정규화 질의·분류·변경 번호·마지막 순위/행 ID를 담는다. 빈 질의는 수정일/행 ID를 사용한다. 질의/분류가 다르거나 손상된 커서는 400이다. 색인이 바뀌면 첫 페이지와 `reset: true`를 반환하고 UI는 누적 결과를 교체한다. 변경 번호·결과·커서는 같은 읽기 savepoint에서 만든다.
- 미리보기는 저장된 평문에서 최대 **180 코드 포인트의 원문**을 추출하고 앞뒤에 최대 두 개의 `…`를 덧붙인다. HTML을 반환하지 않는다. Page 경로와 파일 이동 대상은 반환할 결과에 대해서만 조회한다.
- Capture·Page·Asset·`page_references` 변경 트리거가 원본과 색인을 같은 쓰기 트랜잭션에서 갱신한다. 실패·충돌·가져오기 롤백도 함께 되돌린다. 최초 기존 기록을 한 번 backfill하고, 검색 스키마 v1→v2는 원본을 바꾸지 않고 파생 색인만 원자적으로 재구축한다. 현재 v3의 `page-assets-v1`·`itinerary-text-v1` 이관은 Page 직접 첨부와 일정 작성 텍스트를 파생 색인에 반영한다. 정상 재시작은 전체 재색인하지 않는다. `createSearchStore()`의 `rebuildSearchIndex()`는 명시 재구축용이며 HTTP 경로는 없다.
- 원시 `DatabaseSync` 쓰기 연결이나 외부 쓰기 스크립트도 원본을 수정하기 전에 `registerSearchFunctions(db)`를 등록해야 한다. `search_tokens`·`search_characters`·`search_fold`·`search_capture_text`·`search_page_text`는 검색 트리거가 사용하는 결정적 순수 함수다.
- 검색창은 필요할 때만 불러온다. 입력 대기 200ms·요청 취소·세대 번호로 이전 첫 응답/더 보기 응답을 무시하고, 질의·분류가 바뀌면 기존 결과/커서를 즉시 비운다. 기록 변경·창 집중 후 갱신하며 닫을 때 요청을 취소한다. 로딩·짧은 입력·빈 결과·실패/재시도·더 보기·변경 리셋을 구분한다. 키보드 선택·Tab 초점 순환·닫은 뒤 초점 복귀를 제공하며 뒤의 메모·페이지 초안을 유지한다.
- **현재 제한:** 조합 중 요청·Enter 이동은 보류하지만 조합 중 Escape가 전역 닫기로 전달되어 검색창을 닫을 수 있다. 뒤의 작성 초안은 유지된다. Chrome QA의 합성 조합 이벤트는 운영체제별 네이티브 IME 전체 동작을 검증한 것이 아니다. [독립 리뷰 M1](.omo/evidence/unified_search_review.md#minor)에 기록했다.

`/memo`의 `GET /api/captures`는 기존 SQLite `LIKE` 검색이며, 메모에서 페이지를 고르는 `GET /api/pages/search`는 제목 검색·50개 커서를 유지한다. 통합검색은 현재 개인 로컬 API다. 일반 파일 본문·외부 URL 수집 원문·공개 검색은 포함하지 않으며 검색 자체가 AI/OCR을 실행하지 않는다. 완료된 AI 결과·할 일·명시 OCR 텍스트도 파생 FTS 색인에 포함한다.

성능 자료는 Apple M1 Max / macOS arm64 / Node 24.18.0의 **임시 1만·10만 혼합 원본**이다. v2의 10만 건·20개 결과 저장소 호출 p95는 `여행` 49.711ms·`교토` 15.140ms·`교토 3` 19.005ms, FTS 104.50MiB·전체 DB 408.16MiB였다. 별도 새 읽기 프로세스 RSS는 유휴 79.70MiB·검색 후 82.63MiB다. N100·HTTP·브라우저 지연 실측으로 환산하지 않는다. 자료 구성·v1 비교·검증 로그는 [구현·검증 기록](.omo/evidence/unified_search.md), 상세 측정값은 [v2 보고서](.omo/evidence/search-benchmark-v2.json)를 따른다.

### 할 일

- 홈의 보조 열에는 **할 일** 패널을 둔다. PC는 5개, 760px 이하 모바일은 3개를 먼저 조회한다. 1100px 이하에서는 AI 현황 다음·최근 메모 앞에 배치한다. 모바일 홈은 인라인 입력을 보여주며 하단 기록 도크를 숨긴다.
- 제목을 한 줄로 입력하고 Enter 또는 `+`로 추가한다. 제목을 누르면 같은 행에서 내용·기한을 수정하고 명시적으로 저장한다. 홈의 긴 제목은 말줄임표, 전체 보기의 제목은 줄바꿈으로 표시한다.
- 체크는 즉시 표시하고 저장 뒤 완료 탭으로 옮긴다. 완료 탭에서 체크를 해제하면 대기로 돌아온다. 같은 항목의 요청은 직렬화해 마지막 선택을 저장하고, 실패하면 서버 확인 상태로 복원하며 행에 재시도를 둔다.
- 제목은 1~500자, 완료 상태는 `open`·`done`으로 기존 연결을 유지하고 보드 진행 단계는 `stage: todo|doing|done`으로 제공한다. SQLite의 추가 열 `in_progress`가 미완료의 진행 여부를 저장하며 기존 행·ID·버전·날짜는 이관 때 수정하지 않는다. 기한은 선택적 한국 날짜 `YYYY-MM-DD`다. 기한이 지났거나 오늘까지인 항목을 날짜순으로 먼저 보여주고 나머지는 등록 순서다. 날짜 없는 항목에 오늘 표시를 만들지 않는다. 완료 목록은 최근 완료순이다.
- 수정에는 `expectedVersion`이 필요하다. 충돌 시 409와 최신 항목을 돌려주고 편집 초안을 유지한다. **최신 내용 불러오기**를 누를 때만 초안을 교체한다. 작성·수정 시각은 UTC ISO이며 완료 취소 시 `completedAt`은 `null`이 된다.
- `/tasks`는 **목록 / 보드**를 제공한다. 기본은 보드이고 선택은 `localStorage`의 `leneu:tasks:view`에 기억한다. 목록은 50개 단위이며 보드는 대기·진행 중 각 20개, 완료는 최근 10개부터 열별로 더 조회한다. PC는 3열·드래그 상태 이동, 760px 이하 모바일은 상태 탭·한 열이다. 카드 아래의 상태 선택란은 두지 않고 제목을 눌러 편집할 때 내용·기한·상태를 함께 저장한다. 목록 보기의 빠른 상태 선택은 유지한다. 추가는 대기로 저장하고 카드 제목 클릭으로 같은 자리에서 수정한다. 개수는 DB 전체 상태를 집계한다. 홈·전체 보기·페이지 전환 중 추가·편집 초안은 메모리에 남고, 화면 폭이 바뀌어도 편집 중·실패한 항목을 표시한다. 새로고침 후 미저장 Task 초안 복구는 아직 제공하지 않는다.
- 더 보기 중 다른 탭에서 할 일을 추가·수정·완료하거나 한국 날짜가 바뀌면 목록을 첫 페이지부터 다시 조회·교체한다. 조회 위치만 이어 붙여 남은 항목을 누락시키지 않는다. 보드의 열별 더 보기에서 변경 번호가 달라지면 모든 열을 다시 읽는다. 검색 링크로 고정한 할 일도 갱신 때 최신 상태를 읽되 최초 연결 뒤 사용자가 고른 목록 필터를 강제로 바꾸지 않는다. `task_list_state`의 목록 변경 번호는 SQLite 트리거로 갱신하며 목록·개수·커서는 하나의 읽기 트랜잭션에서 조회한다.
- 추가 요청은 UUID `requestId`로 재시도 중복을 방지한다. 같은 제목으로 새로 추가하는 독립 요청은 합치지 않는다. 할 일은 메모·페이지 체크리스트·AI와 자동 동기화되지 않는다. 원문 연결·체크리스트 가져오기는 이후 단계다.

### 날짜·시간

- 서버는 생성 순간을 `new Date().toISOString()`의 **UTC ISO 8601 문자열**로 `captures.created_at`에 저장한다. API의 `createdAt`은 이 값을 그대로 반환한다.
- 사이드바 날짜는 `formatKoreanDate(now)`로 **`YYYY-MM-DD (요일)`**을 표시한다. `Intl.DateTimeFormat`의 `Asia/Seoul` 날짜·요일을 사용하며 `<time datetime="…">`은 해당 한국 날짜다.
- 수정 순간은 `captures.updated_at`과 API의 `updatedAt`에 UTC ISO 형식으로 저장한다. 메모 상세와 페이지 제목 아래에 한국 시간의 **생성일·최종 수정일**을 항상 표시한다. 수정 전에는 두 시각이 같고 저장 성공 시 최종 수정일을 갱신한다. 수정해도 `createdAt`과 `NEW` 기준은 바뀌지 않는다.
- 목록과 상세 화면은 기기 시간대와 관계없이 **한국 시간(`Asia/Seoul`)**으로 변환한다. 오늘 쓴 항목은 `오늘 오후 12:30`처럼 표시하고, 이전 항목은 **`YYYY-MM-DD HH:mm`**으로 표시한다. 날짜 경계도 한국 시간을 따른다. DB/API에는 UTC ISO 형식으로 저장한다.
- 보관 항목의 `<time datetime="…">`에는 원래 ISO 값을 남긴다. 목록 카드에서 생성 시각과 같은 줄 오른쪽 끝의 `NEW`는 생성 후 **24시간 미만**인 항목에만 표시한다. 화면을 열어 두면 1분 간격으로 표시 여부를 갱신한다. 할 일의 기한·오늘 경계도 한국 날짜를 따르며 1분마다 날짜를 확인한다.

## 빠른 입력·템플릿 초안 복구

- `src/drafts/`는 같은 탭에서 새로고침한 뒤 메모·입력 종류·URL·AI 체크·선택한 템플릿·추가 요청을 복구한다. 텍스트는 250ms 입력 대기 후 저장하고 `pagehide`·문서 숨김·언마운트 때 최신 값을 저장한다. 입력마다 동기 저장하지 않는다.
- 탭 식별자는 `sessionStorage`의 `leneu:draft-session:v1`이다. `localStorage`의 `leneu:capture-draft:v1:<탭 ID>`와 `leneu:prompt-drafts:v1:<탭 ID>`에 `{schemaVersion: 1, value}`로 기록한다. 별도로 연 탭은 각자 초안을 쓴다. 탭을 닫은 뒤 새 탭에서 이전 초안을 선택하는 기능은 없다.
- 첨부 바이트는 IndexedDB `leneu-draft-files-v1`의 `attachments` 저장소에 같은 탭 ID로 보관한다. 파일명·MIME·수정 시각도 복구한다. 복구 중에는 Capture 저장·새 첨부를 막으며, **첨부 임시저장 중…**이 끝나기 전에 창을 닫으면 첨부 복구를 보장하지 않는다. 저장 공간·복구 오류는 파일 재선택 안내와 함께 표시한다.
- Capture 저장 성공 시 보낸 내용·파일과 현재 입력이 같을 때만 초안을 비운다. 요청을 기다리는 동안 작성한 다음 메모는 유지한다. 템플릿 명시 저장 성공 시 해당 편집 초안만 지우고, 다른 미저장 템플릿은 유지한다. 복구된 템플릿도 원래 `expectedVersion`과 `expectedRevisionId`로 충돌을 검사한다. 저장 중 추가로 쓴 내용은 초안으로 유지하고, 늦은 응답으로 다른 템플릿으로 이동하지 않는다.
- 템플릿 초안은 서버 항목 200개·기존 브라우저 항목 200개·새 항목 1개까지 함께 복구한다. 복구 형식이 손상되면 원본을 보존하고 새로운 초안의 임시저장을 중단하며 명시 저장·복사를 안내한다.
- 생성 응답 유실 뒤 새 작성 화면과 생성된 항목 양쪽을 따로 편집했다면 두 초안을 모두 유지한다. 재시도 확인으로 다른 초안을 덮지 않고 현재 화면에서 별도 복제를 안내한다.
- 이 초안은 브라우저에만 있으며 서버 동기화·장기 백업이 아니다. 브라우저 저장소를 지우거나 프로토콜·호스트·포트가 바뀌면 같은 초안을 사용할 수 없다. Task 초안의 새로고침 복구는 별도 미구현 범위다.

## 프롬프트 관리·AI 요청 시안

- 사이드바 **프롬프트**는 `/prompts`, 개별 편집은 `/prompts/:id`다. 관리 화면·입력함 AI 설정·템플릿 API는 필요할 때만 불러온다. 입력함 첫 로드에는 템플릿 API도 호출하지 않는다. BlockNote나 AI SDK는 사용하지 않는다.
- URL 리서치·키워드 리서치·생각 정리·여행 계획의 실제 기본 템플릿 4개를 추가·수정·복제·보관·꺼낼 수 있다. 종류 표시는 **리서치 / 자유 요청**이며 기존 URL 리서치 이름은 유지한다. 보관된 항목은 요청 선택란에서 제외하며 **직접 요청**도 제공한다.
- 기존 DB에는 `research-keyword`가 없고 보관 항목을 포함한 템플릿 수가 200개 미만일 때만 키워드 리서치 기본값을 추가한다. 기존 ID·수정본·보관 상태·라이브러리 ID를 덮지 않는다. 200개가 찬 DB는 그대로 시작하며 사용자가 다른 템플릿을 리서치 종류로 편집할 수 있다.
- 템플릿은 **서버 SQLite**에 저장해 같은 서버의 다른 브라우저에서도 사용하며 서버·컨테이너 재시작 뒤 유지된다. 필드는 `id`, `name`, `description`, `kind`, `body`, `archived`, `version`, `revisionId`, `createdAt`, `updatedAt`다. 이름 80자·설명 200자·본문 10,000자·최대 200개(보관 포함)다. 저장마다 버전과 불변 수정본 UUID가 생긴다. 템플릿 수정 이력 조회·복원 UI는 아직 없으며 AI 작업은 선택 당시 템플릿 사본을 사용한다.
- 변수 `{{url}}`·`{{content}}`·별칭 `{{memo}}`는 한 번만 치환한다. `content`는 작성한 메모이며 URL에서 수집한 본문이 아니다. 입력 자체의 변수 표기는 보존하고 미등록 변수는 거절한다. 테스트 URL·메모와 요청문 복사를 제공한다.
- 입력함 **AI 요청**은 템플릿·추가 요청(1,000자)·요청 미리보기·관리를 펼친다. 리서치·일반 메모의 최근 선택은 `leneu:recent-prompt-templates:v1`에 기기별로 기억한다. 보관된 선택은 활성 기본값·직접 요청으로 대체한다. 관리 화면을 다녀와도 원래 메모·첨부·AI 설정을 유지하며 **입력함에서 사용**은 모바일 입력 시트까지 다시 연다.
- 목록은 첫 진입·창 집중·같은 origin의 탭 변경 알림 때 갱신한다. 지속적인 실시간 동기화는 아니다. 수정에는 `expectedVersion`·`expectedRevisionId`가 함께 필요하며 충돌은 409와 최신 항목을 반환한다. **최신 내용 불러오기**를 고르기 전까지 초안을 유지한다. 로딩·연결 실패에는 재조회가 있다. 생성 UUID와 최초 전송 스냅샷(`pendingCreation`)은 첫 요청 전에 브라우저 초안에 남긴다. 응답이 끊긴 뒤 내용을 고쳐도 최초 스냅샷을 재전송해 생성 중복을 막는다. 확인된 최초 수정본에 추가 입력을 초안으로 연결하며 다음 명시 저장으로 반영한다. 가져오기 중 입력함에서 선택을 바꾸면 최신 선택을 유지한다.
- 이전 `leneu:prompt-templates:v1`이 있으면 **브라우저 템플릿 가져오기**로 옮긴다. 동일 내용은 합치고, 수정하지 않은 서버 기본값은 브라우저 내용으로 갱신하며, 이미 수정한 서버 템플릿과 충돌하면 복사본을 만든다. 모든 항목을 검증하고 한 트랜잭션으로 가져온다. 브라우저 원본은 삭제하지 않으며 같은 원본의 재시도는 중복을 만들지 않는다. 완료 표시는 저장소 UUID·원본 해시에 연결한다.
- 원본 버전과 일치하는 이전 초안만 대상 ID·최초 가져오기 수정본으로 연결한다. 다른 탭의 이전 초안은 그 탭에서도 가져오거나 복제한다. 오래된 버전·이미 서버 수정본을 가진 초안을 최신 버전으로 자동 승격하지 않는다. 연결되지 않은 초안은 목록에서 열어 복제할 수 있다. 손상된 브라우저 저장값은 덮지 않는다.
- **가져오기·내보내기**는 `{schemaVersion: 1, items}` JSON 파일이다. 가져오기는 16MB·200개까지 받는다. JSON 이스케이프를 포함한 유효한 전체 라이브러리를 옮길 수 있는 크기다. 파일은 현재 템플릿만 담고 수정 이력·미저장 초안·최근 선택은 담지 않는다. 전체 수정 이력은 DB 백업으로 옮긴다.
- 760px 이하에서는 본문 먼저, 접힌 **템플릿 설정**, 전용 하단 **미리보기 / 템플릿 저장**을 사용한다. 이름 없이 저장하면 설정을 열고 이름에 집중한다. 공통 기록 도크는 숨기며 메뉴를 열면 저장 줄도 숨긴다. `visualViewport`·safe area에 맞추며 실제 휴대폰 키보드 검증은 추후 한다.
- AI 체크 후 보관은 Capture와 당시 템플릿·추가 요청·입력·요청문·대기 작업을 원자적으로 저장하고 `/memo?view=ai`에 표시한다. 상세에서 요청문과 결과를 읽고 복사할 수 있다. 추가 요청은 1,000자, 템플릿 본문은 10,000자, 조립된 요청문은 64,000자까지 검증한다. 잘못된 요청 JSON이나 설정은 400이며 원본·첨부를 부분 저장하지 않는다.
- 템플릿 관리 화면의 요청 미리보기는 URL 수집이나 AI 실행을 하지 않는다. 실행은 AI 체크 후 원본 저장·보관한 AI 요청 상세의 명시적 재요청 또는 저장된 Page의 명시적 요청으로 시작한다. 첨부 바이트는 전달하지 않는다.
- 복구한 템플릿의 최초 조회가 미완료·실패이면 보관 버튼과 키보드 저장을 막고 선택·초안을 유지한다. 다시 불러오거나 사용자가 **직접 요청**을 명시적으로 고르면 보관할 수 있다. 불러오지 못한 템플릿을 직접 요청으로 몰래 바꾸지 않는다.

## AI 요청 실행

### 저장·상태·이력

- 새 AI Capture는 원본·불변 요청 사본·제출 UUID 기록·`queued` 작업을 같은 SQLite 트랜잭션에서 저장한다. 저장 응답은 AI 완료를 기다리지 않는다. 실행기 미설정·호출 실패와 원본 저장 성공은 구분한다. 기존 `prepared` 항목·예시를 이관하거나 앱을 시작하는 동작은 새 작업을 만들지 않는다.
- 주제는 메모 본문에 적고 **AI 요청 → 키워드 리서치 → 저장하고 AI 요청**를 선택한다. 저장 후 비동기로 검색·수집·요약하고 `/memo?view=ai`의 상세에서 결과·이력·확인한 출처를 읽는다. 기존 원본·첨부·생성/수정 시각·UUID·버전 계약과 지연 UI를 유지한다.
- 브라우저는 첫 전송 전에 `localStorage`에 UUID·입력 지문·선택한 템플릿/추가 요청 사본을 남긴다. 지문에는 입력·AI 선택과 순서가 있는 파일명·MIME·크기·SHA256 바이트 해시를 포함한다. 같은 입력의 새로고침·응답 유실 재시도는 최초 선택 사본을 재사용하며 서버는 같은 UUID·지문에 기존 Capture를 반환한다. 같은 UUID의 다른 내용은 409이고 재업로드한 중복 바이트는 제거한다. 저장 확인 정보를 보관하지 못하면 전송을 막는다.
- 작업은 `queued → running → result_ready | failed`로 전이한다. 화면은 **요청 준비됨**(작업 없음), **대기 중**, **처리 중**, **결과 준비됨**, **처리 실패**를 사용하고 `runner_unavailable` 실패는 **연결 필요**로 표시한다. 작업자 하나가 순서대로 실행하며 동일 Capture 또는 Page의 진행 중 작업을 중복 등록하지 않는다.
- 작업의 입력·프롬프트·원본 버전은 불변이다. **현재 메모로 다시 요청**은 현재 저장된 원문과 처음 보관한 템플릿 사본·추가 요청으로 새 작업을 만든다. **실패한 요청 그대로 재시도**는 실패한 이전 작업의 사본·버전을 유지하고 `retryOf`로 연결한다. 현재 버전은 등록 시 확인하지만 UUID 재전송은 기존 작업 조회가 먼저다. 브라우저도 명시 요청의 UUID·인자를 확인 전까지 보존한다.
- 작업 완료는 현재 `running` 상태·실행 토큰이 일치할 때만 기록한다. 재시작 시 `queued`는 보존하고 미완료 `running`은 `interrupted` 실패로 정리한다. 실패·중단·시간 초과의 자동 유료 재시도와 제공자 자동 전환은 없다.
- AI 결과는 `ai_jobs.result_json`에만 저장한다. Capture 내용·버전·생성/수정 시각·첨부와 Page 본문을 자동으로 바꾸지 않는다. 현재 소유 기록의 버전과 다르면 **이전 내용 기준**을 표시하고 이전 결과는 남긴다. 정리 완료 메모의 이력은 원본 상세·페이지 출처에서 계속 조회한다. 휴지통 소유 기록의 작업 조회는 숨기며, 실행 전 이동한 작업은 `source_deleted` 실패로 정리해 보내지 않는다. 실행 도중 이동한 작업은 종료 후 숨기고 복원하면 이력을 다시 볼 수 있다.
- 상세는 최신 50개 이력·선택한 결과·출처·Markdown 복사와 접힌 **요청 당시 입력·프롬프트**를 제공한다. 결과 Markdown은 React 텍스트로 표시하고 HTML을 실행하지 않는다. 리서치는 실제 수집한 출처, 자유 요청은 **본문 미확인** 참고 링크로 구분한다. 선택한 완료 결과는 **결과를 페이지로 정리**로 담을 수 있다. Task 채택과 AI 결과 검색은 아직 없다.
- AI 상세·목록 갱신은 지연 로딩한다. 보이는 상세의 진행 중 작업은 2초마다 갱신하고 닫힘·문서 hidden·터미널 상태에서 멈춘다. 목록은 화면에 보이는 진행 중 항목만 최대 20개의 요약 API로 갱신하며 전체 결과를 폴링하지 않는다. 이전 원본·이전 응답을 새 상세에 덮어쓰지 않는다.

### AI 요청 모니터

- 홈 보조 열의 **AI 요청** 현황은 메모·Page 작업 중 진행 중 상태를 우선해 최대 3개를 보여준다. 1100px 이하에서는 인라인 입력 다음에 놓인다. 일반 메모 최근 3개와 별도 목록이며 작은 현황 모듈을 지연 로딩한다. 결과·페이지 편집기·Mermaid를 현황 의존성으로 불러오지 않는다.
- 사이드바 **AI 요청**과 `/ai`는 **전체 / 진행 중 / 결과 준비 / 실패** 탭을 제공한다. `?status=active|result_ready|failed`로 해당 상태를 바로 열 수 있다. 진행 중은 `queued`·`running`이다. 상태별 개수는 활성 소유 기록의 DB 전체 작업을 집계하고, 행은 선택한 상태의 최근 50개다. 더 보기·커서는 없으며 이전 이력은 소유 메모·페이지에서 찾는다. 요청·시작·완료/종료·마지막 확인 시각은 `Asia/Seoul`로 표시한다.
- 실행 작업이 있는 정리 완료 메모도 포함하고 **정리 완료**를 표시한다. 휴지통 Capture·Page의 작업은 목록·개수에서 제외한다. 작업 없는 `prepared` 요청·예시는 `/memo?view=ai`의 **보관한 요청문**에서 관리한다. 모니터 조회는 작업 등록·취소·자동 재시도·제공자 호출을 수행하지 않는다.
- 행은 `/captures/:id?aiJob=:jobId` 또는 `/pages/:id?aiJob=:jobId`로 해당 작업을 선택한다. 최신 50개 이력에 없는 작업은 단건 API로 조회해 소유 ID를 검사한다. Page AI 패널은 자동으로 열리고 연결된 메모 상세를 닫으면 `/ai`로 돌아온다. **새 AI 요청**은 현재 초안을 유지하며 입력함의 AI 설정을 켜고 모바일 입력 시트를 연다. 모바일 `/ai`는 공통 하단 기록 도크를 숨겨 요청 행을 가리지 않는다.
- 첫 조회는 네이티브 `IntersectionObserver`의 실제 교차 알림 뒤에 시작한다. 영역이 보이고 탭이 활성일 때 진행 중 작업이 하나라도 있으면 2초, 없거나 조회가 실패하면 30초 간격으로 갱신한다. 화면 밖·언마운트·문서 숨김에는 타이머·요청을 취소한다. 기록 변경·창 집중·같은 origin의 다른 탭 변경도 보이는 영역을 갱신한다. 오류 때 같은 필터의 마지막 상태는 남기되 오래된 확인값임을 알리고 다시 불러오기를 제공한다.
- 개인 `GET /api/ai/activity?view=compact|full&status=all|active|result_ready|failed`는 `{items, counts, total}`을 반환한다. 기본은 `full`·`all`, `compact`는 진행 중 우선 최대 3개, 나머지는 최근 50개다. `counts`는 `queued`·`running`·`result_ready`·`failed`별 전체 개수이고 `total`은 선택한 상태의 전체 수다. 유효하지 않은 `status`는 400이다. 개수와 행은 같은 읽기 savepoint에서 조회한다.
- 요약에는 작업·소유 ID, 이동 주소, 상태·오류 코드·시각·정리 여부와 제한된 텍스트만 포함한다. 입력 내용(없으면 URL) 미리보기·Page 제목은 각각 180자, 템플릿 이름은 100자까지다. 전체 요청문·결과·문서·파일·실행 토큰은 반환하지 않는다. 이 확장은 DB 스키마·색인·의존성을 추가하지 않는다. 화면 전략은 [AI 현황 brief](.impeccable/briefs/ai-activity.md)에 기록하며 기존 디자인 시스템을 유지한다.

### AI 결과 페이지 정리

- **결과를 페이지로 정리**는 상세에서 선택한 완료 작업의 결과를 사용한다. 기본은 새 페이지이며 기존 페이지 끝에 추가하거나 선택한 상위 아래 새 하위 페이지를 만든다. 맨 앞의 유효한 H1을 새 제목으로 제안하고 제목이 제안값과 같으면 본문 H1을 제거한다. 빈 H1·들여쓴 코드를 제목으로 처리하지 않고 H1 뒤 코드 들여쓰기를 보존한다. 제목을 바꾸거나 기존 페이지에 추가하면 H1을 유지한다.
- 결과 Markdown에 별도 출처 목록을 링크로 붙인다. 리서치는 **확인한 출처**, 자유 요청은 **참고 링크** 제목을 쓴다. 새 UI는 `disposition: 'organize'`로 원본 메모를 정리 완료로 보관하고 출처를 페이지 정보에 남긴다. 본문에 메모 카드·태그를 자동으로 넣지 않는다. 원문 복사·첨부는 기본 미선택이며 선택하면 메모 가져오기 규칙을 따른다.
- 제출할 때만 [src/pages/parseMarkdown.ts](src/pages/parseMarkdown.ts)를 지연 로드해 제목·문단·목록·체크리스트·인용·표·코드·구분선을 블록으로 변환한다. `mermaid` 코드 울타리는 `diagram` 블록이 된다. [src/ai/pageContent.ts](src/ai/pageContent.ts)가 제목 제안·본문 H1 처리·출처를 조립하며 첫 입력 화면에 편집기·Mermaid를 넣지 않는다.
- 기존 가져오기 API의 선택적 `aiResult: {jobId, document}`를 사용한다. 서버는 해당 Capture의 `result_ready` 작업·결과와 `schemaVersion: 1` 문서를 검사한다. 허용된 블록·안전한 링크·1MB/1,000블록 상한을 적용하고 AI 변환 문서 안의 `captureRef`·`asset`·`page`·`tableOfContents`는 거절한다. 출처 기록은 본문과 분리하며 `disposition`을 생략한 이전 복사 API만 기존 `captureRef` 생성 계약을 유지한다.
- Page의 기준 저장값은 블록 JSON이다. 담은 뒤 바로 편집·자동 저장하고 페이지 전체를 하나의 **Markdown 보기 / Markdown 복사**로 변환한다. Page 사본과 완료된 AI 작업 결과는 각각 검색 대상이다. 원본 Capture의 내용·버전·첨부·생성/수정 시각과 AI 작업의 요청 사본·결과는 바꾸지 않는다. 편집한 Page도 원본이나 AI 작업으로 역전파되지 않는다.
- 가져오기 UUID·선택한 작업 ID·변환 문서·대상·선택을 제출 사본으로 고정한다. 문서 쓰기·참조 색인·출처·정리 상태·`page_import_operations` 영수증은 같은 트랜잭션이며 같은 UUID·동일 요청은 최초 응답을 돌려준다. 응답 유실·5xx에서는 선택을 잠그고 **같은 요청 다시 확인**을 제공한다. 같은 탭의 `sessionStorage` 복구는 변환 문서도 재사용한다. 400·404·409는 대기를 해제하고 오류를 표시한다. 새 UUID로 같은 결과를 명시적으로 다시 담으면 별도 가져오기이며 서버가 새 블록 ID를 만든다.

### 페이지 AI

- 페이지의 **AI 요청**은 전체 **저장된** Page를 기본 입력으로 사용한다. 선택적 `blockIds`가 생략되거나 비어 있으면 제목과 작성 본문 전체를 서버에서 Markdown으로 만든다. 선택한 편집 가능 블록이 있으면 문서 순서대로 그 블록과 자식 본문을 사용한다. 부모와 자식을 함께 고르면 선택 루트만 `targetBlockIds`에 기록한다. 없는 ID·중복 ID·개인 참조 블록 선택은 거절한다.
- `captureRef`·`asset`·`page`·`tableOfContents` 자체와 참조 대상 본문·첨부 바이트는 AI 입력에 넣지 않는다. 선택·직렬화는 저장 문서에 한정하며 개인 참조 대상·첨부를 숨겨 조회하거나 수집하지 않는다. 저장된 전체 `sourceDocument`·`sourceTitle`·`sourceVersion`, 선택 루트 ID, 조립 Markdown·템플릿·추가 지시·요청문을 불변 작업 사본으로 보관한다. 외부 실행기에는 공통 요청의 텍스트·URL·명시한 리서치 수집 자료만 전달한다.
- 저장되지 않은 변경·저장 오류·충돌·미해결 초안 복구·휴지통 작업 중에는 요청·반영을 막는다. Page 입력은 64,000자, 조립 요청문도 64,000자까지이며 초과하면 블록 범위를 줄인다. 실행기·리서치 경로·동시 작업 1개·120초와 기본 모델 `swe-2-high`는 메모 요청과 같다. Page의 최신 50개 작업을 조회하고 진행 중 상태만 가시 화면에서 갱신한다.
- 작업 실행 중 문서를 계속 편집할 수 있으며 완료 결과는 별도 제안이다. 재요청은 현재 저장 Page를 기준으로 새 사본을 만들고 이전 작업 재시도는 당시 제목·문서·입력·선택·버전을 그대로 재사용한다. `stale`은 현재 Page 버전과 요청 버전 차이를 뜻한다.
- 결과 적용은 완료된 **해당 Page 소유** 작업을 골라 `append`(**본문 아래 추가**, 기본)·`replace`(**선택한 블록 교체**)·`child`(**새 하위 페이지**) 중 명시적으로 제출한다. 클라이언트가 변환한 결과 문서를 서버가 검사하고 모든 새 블록 ID를 다시 만든다. AI 결과 안의 개인 참조·첨부·페이지 링크·목차는 거절한다. 현재 문서 전체를 Markdown으로 다시 파싱해 교체하지 않는다.
- 모든 반영은 현재 `expectedVersion`을 검사한다. `replace`는 기록한 선택이 있어야 하고 현재 버전이 `sourceVersion`과 같으며 선택 블록이 남아 있어야 한다. 첫 선택 위치에 결과를 넣고 나머지 선택 블록을 제거하며 다른 블록·첨부·목차·페이지 링크는 보존한다. 요청 후 Page가 수정되면 교체는 409이고 최신 Page에 추가하거나 다시 요청할 수 있다. `child`도 현재 원본 Page 버전을 확인한 뒤 제목 기본값 `AI 결과`로 새 하위 Page를 만든다.
- `append`·`replace`는 직전 저장 제목·문서와 반영 버전을 `page_ai_revisions`에 남기며 Page 쓰기·참조 색인·반영 영수증은 한 트랜잭션이다. **AI 반영 되돌리기**는 현재 `expectedVersion`과 해당 `applied_version`이 같을 때만 직전 제목·문서를 새 버전으로 복원한다. 반영 이후 편집·이동·휴지통 복원 등으로 버전이 변했으면 409로 거절한다. 이 기능은 일반 편집 이력 조회·복원이 아니다. `child`는 원본 Page 수정본을 만들지 않으므로 새 하위 Page를 기존 휴지통으로 옮겨 되돌린다.
- 요청·반영·되돌리기는 각각 UUID와 최초 본문·경로를 `localStorage`의 `leneu:page-ai-submit:v1:<pageId>`에 첫 전송 전에 남긴다. 페이지 이동·새로고침·응답 유실 후 **같은 요청 다시 확인**은 이 본문을 재사용하며 서버는 버전 검사보다 영수증을 먼저 확인한다. 같은 UUID의 다른 본문은 409다. 확인 대기 중에는 새 AI 제출을 막고 반영·되돌리기 대기 중에는 Page 편집도 잠근다. 요청의 응답 대기나 실행 중에는 Page를 계속 편집할 수 있다. 파싱한 400·404·409도 최초 사본을 유지하되 **확인된 실패 닫기**로 대기를 명시적으로 해제할 수 있다. 전송/JSON 확인 실패·5xx는 같은 요청으로 확인한다. 저장소 오류로 제출 사본을 보존하지 못하면 전송을 막고, 손상된 사본을 읽지 못하면 새 제출·Page 편집을 잠근 채 복구 안내를 남긴다. 추가·교체·되돌리기 성공 확인 후에는 최신 Page를 다시 조회해 오래된 영수증 본문으로 새 편집본을 덮지 않는다. 마지막 추가·교체의 작업 ID·반영 버전은 `leneu:page-ai-last-apply:v1:<pageId>`에 남아 같은 브라우저에서 되돌리기 버튼을 복구한다.

### 실행기 설정과 경계

기본 실행 프로필은 Hive이며 키·모델이 없으면 실행되지 않는다. `.env.example`/Compose의 명시 `AI_RUNNER_KIND=disabled`는 모든 프로필의 실행을 끈다. `GET/PUT /api/ai/settings`는 등록된 Hive·Devin 모델과 기본 선택을 SQLite `ai_settings`에 저장하며 `expectedVersion` 충돌을 검사한다. 키·인증 파일·경로는 응답에 없다. 환경 모델값은 최초 기본값이고, 설정 저장 후에는 DB 값이 우선한다.

`GET /api/ai/status?profile=hive|devin`은 해당 프로필의 `{enabled, runner, supports, researchModes, attachments:false}`와 설정 요약을 반환한다. `runner`에는 label/mode/profileId/model이 포함된다. 설정 상태는 실제 로그인·제공자 응답 검증이 아니다. Hive/HTTP의 리서치는 URL만, Devin은 URL·키워드다. 요청에는 `execution:{profileId,model}` 사본을 저장하고 큐에 들어간 뒤 설정이 바뀌어도 당시 모델을 사용한다. 같은 UUID 재전송과 실패한 요청 그대로 재시도도 이 사본을 유지한다. 이전 모델과 다른 최신 모델로 요청하려면 명시적으로 새 요청을 만든다.


| 서버 설정                           | 현재 계약                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `AI_RUNNER_KIND=hive` | Hive 기본 + Devin 선택. `HIVE_API_KEY`/`HIVE_MODEL`을 서버에 설정. Chat Completions SSE/JSON·사용량·취소 검사 |
| `AI_RUNNER_KIND=disabled` | 모든 등록 프로필의 실행 끄기 |
| `AI_RUNNER_KIND=devin`              | 설치·인증된 Devin CLI를 명시적으로 선택. `AI_DEVIN_BIN`은 선택적 실행 경로(기본 `devin`), `AI_DEVIN_MODEL`은 모델(기본 `swe-2-high`) |
| `AI_RUNNER_KIND=http`               | `AI_RUNNER_URL`의 게이트웨이 호출. KIND 없이 URL만 설정해도 선택. HTTPS 또는 루프백 HTTP, URL credentials·redirect 거절              |
| `AI_RUNNER_TOKEN`                   | 선택적 게이트웨이 Bearer 인증. 서버에만 저장                                                                                         |
| `AI_RUNNER_LABEL`, `AI_RUNNER_MODE` | HTTP 실행기 표시 이름(최대 80자), `test`일 때 테스트 응답 표시; 기본은 live                                                          |
| 유효한 키·실행 파일·모델 없음   | 원본 저장 후 작업에 `runner_unavailable` 실패를 남김                                                                         |

Devin CLI는 실행기이며 모델은 앱이 `AI_DEVIN_MODEL`의 설정값(기본 `swe-2-high`)을 `--model`로 명시적으로 전달한다. 완료 결과는 작업에 기록된 실행기·모델을 구분해 표시한다. 2026-09-29 사용자 요청으로 기본 모델을 SWE-2 High로 변경했다. 완료된 작업은 당시 모델 기록을 유지한다.

HTTP 요청은 `{schemaVersion: 1, jobId, kind, prompt, input, materials, policy}`다. `input`은 `{content, url}`, 수집 자료는 `{url, title, text, fetchedAt}`이며 `policy`는 `{tools: false, maxOutputTokens: 4096, treatMaterialsAsData: true, output: 'markdown-sources-usage'}`다. 게이트웨이가 선택한 제공자 계약으로 번역해야 하며 OpenAI·Anthropic 직접 API 형식은 지원하지 않는다. HTTP에는 검색 capability가 없고 키워드 요청은 게이트웨이 요약 호출 전에 실패한다. 제공자별 검색 API를 추가하지 않았다.

응답은 JSON `{markdown: string, sources?: [{url, title?}], usage?: {inputTokens?, outputTokens?}}`다. 빈 본문·상한 초과·위험한 링크·잘못된 형식은 `invalid_result`로 거절한다. 리서치의 응답 출처는 수집한 최종 URL과 대조하고 저장 출처는 `{url, title, verified, fetchedAt}`다. 자유 요청 링크는 수집 검증을 하지 않는다. 보고받지 않은 사용량은 `null`이며 비용을 추정하거나 제공자 호출 수로 바꾸지 않는다.

Devin은 요청·고정 설정만 있는 작업별 임시 디렉터리와 0600 파일을 사용한다. 고정 `spawn` 인자와 최소 환경 변수로 실행하고 앱/API 키는 전달하지 않는다. 키워드 검색 단계는 `web_search`만 허용한다. 요약 단계는 `web_search`도 금지하며 두 단계 모두 read/edit/grep/glob/exec/fetch/Fetch/MCP·하위 에이전트를 금지한다. 다른 에이전트 설정 가져오기와 자동 업데이트를 끈다. **OS 샌드박스는 아니며 설치된 CLI의 인증 저장소와 제공자는 유지된다.** CLI를 자동 설치·인증하지 않고 기본 Docker 이미지도 포함하지 않는다.

작업 제한은 120초, JSON 결과 상한은 256KiB다. native stdout·stderr의 합계도 실행당 256KiB로 제한한다. 키워드 작업의 검색·요약 CLI 실행 2회는 순차로 진행하며 본문 수집까지 기존 동시 작업 1개·120초 deadline·중단 signal을 공유한다. Mac/Linux에서는 소유한 POSIX 프로세스 그룹에 SIGTERM을 보내고 200ms 뒤 SIGKILL로 강제 종료하며, 실제 child `close`·임시 디렉터리 정리와 `runner.drain(signal)`을 마친 뒤 실패 기록·다음 작업·서버 종료를 진행한다. Windows는 직접 자식만 종료하므로 하위 프로세스 보장 범위가 다르고, 소유 그룹을 벗어난 프로세스의 종료도 보장하지 않는다. 현재 배포 대상은 Mac/Linux Docker다. HTTP 실행은 제한 시간 내 중단하되 제공자의 이미 진행 중인 작업·과금 취소까지 보장하지 않는다.

### URL·키워드 리서치와 제한

`kind: research`는 URL이 있으면 기존 URL 경로가 우선이고, URL 없이 비어 있지 않은 `input.content`가 있으면 키워드 경로를 사용한다. URL 없는 주제 리서치에는 리서치 종류 템플릿을 선택한다. 템플릿 없는 직접 요청은 URL이 있으면 `research`의 URL 경로, 없으면 `free`다. 템플릿·불변 요청 사본의 형식은 그대로다. 자유 요청의 글이나 URL 문자열은 검색을 시작하지 않는다.

URL 경로는 서버가 입력한 공개 HTTP·HTTPS URL 하나의 본문을 먼저 수집한다. URL credentials·localhost·사설/예약 IPv4·IPv6·DNS의 차단 주소를 거절하고 각 리다이렉트에서도 URL·DNS를 다시 검사한다. 검사한 IP로 연결 주소를 고정한다. 한 URL의 수집 한도는 10초·리다이렉트 3회·2MiB·추출 텍스트 50,000자이며 HTML/평문만 받는다. 수집 실패는 구분된 실패로 남기고 제공자에게 본문을 만들어 달라고 요청하지 않는다.

키워드 경로는 선택적 `runner.discover({job}, signal)`로 후보를 찾는다. 현재 Devin만 제공한다. 고정 검색 프롬프트는 웹 검색 한 번·질의 240자 이하·`num_results: 5`·후보 최대 5개를 지시한다. ATIF export는 실제 `web_search` 호출 정확히 1개와 호출 ID에 연결된 관측 결과를 요구하고 질의 240자·결과 요청 1~5개를 검사한다. 최종 후보 URL은 해당 결과의 `URL:` 행에 나온 주소여야 하며 다른 도구 호출을 거절한다. export 상한은 1MiB다. 이 규칙은 호출 후 검증이며 제공자 비용 상한이나 OS 샌드박스가 아니다.

정규화한 고유 후보 URL 최대 5개를 기존 collector로 순차 수집하고, 고유한 최종 URL의 본문 최대 3개를 확보하면 멈춘다. 차단·실패·크기 초과 후보는 건너뛴다. 본문당 16,666자·합계 49,998자 이내만 요약에 전달한다. 본문이 0개면 요약 호출 전에 `research_no_sources`로 실패하며 일부만 확보하면 결과 앞에 앱의 **수집 안내**를 붙인다. 요약에는 제공한 본문만 사용하도록 지시하고 저장된 확인 출처는 실제 수집 최종 URL과 대조한다.

검색 capability가 없는 실행기의 `research_search_unavailable`은 URL 입력이나 검색 가능한 Devin 연결을, `research_no_sources`는 주제를 구체화하거나 공개 URL로 다시 요청하도록 한국어로 안내한다. 두 실패 모두 원본을 보존하고 사용자의 명시적 재요청·재시도로만 다시 실행한다. 검색 실패를 자유 요청이나 다른 유료 제공자로 자동 전환하지 않는다.

자유 요청은 원문·URL 문자열만 사용한다. 어떤 실행기에도 첨부 바이트·DB·전체 파일 저장소를 전달하지 않는다. 첨부만 있고 글·URL이 없는 요청은 원본을 보관한 뒤 `unsupported_input` 실패로 남기고 글과 첨부가 함께 있으면 글만 처리한다. 명시 OCR은 별도 이미지 HTTP 게이트웨이·작업으로 처리한다. 결과에서 선택한 할 일 채택과 AI 결과/OCR 검색은 구현했고 일반 첨부 이해·예약 리서치는 후속 범위다.

## 실제 예시 자료

`npm run seed:memo`는 현재 `DATA_DIR`(기본 `data/`)에 일반 메모·링크·PNG 여행 메모·Markdown 파일 4개, 리서치·여행 계획의 실행 전 요청 2개, 여행 문서와 하위 예약 체크 문서 2개, 독립 Task 2개를 만든다. 이미지·파일 바이트는 실제 첨부 저장소에 있다. 여행 문서는 직접 작성한 예시이며 AI가 생성한 결과가 아니다. Capture의 `sample_key`, 페이지의 `sample.*` 역할, Task의 고정 `requestId`로 재실행 중복을 막고 수정·이름 변경·Task 상태를 보존한다. Capture의 `isSample`은 API 메타데이터로 남기되 메모 목록·상세에는 별도 예시 표시를 붙이지 않는다. 페이지·Task의 제목은 저장된 내용을 그대로 보여준다. 자동 시작 시에는 생성하지 않는다.

## 메모 → 페이지 정리

메모 상세의 **내 페이지에 정리**에서 기존 페이지 또는 새 페이지를 고른다. 새 페이지는 선택한 상위 아래 또는 내 페이지 최상위에 생성한다. 내용 복사와 첨부별 선택을 제공하며 새 UI는 `disposition: 'organize'`를 명시한다. 선택한 내용만 본문에 담고 원본 메모 카드·태그를 자동으로 만들지 않는다. 내용은 최신 저장된 원문을 줄바꿈을 보존한 일반 문단으로 복사하고 Markdown으로 해석하지 않는다. URL은 링크로 복사한다. 성공 후 문서로 이동해 가져온 첫 블록 위치를 보여주고 제목이 없으면 제목에 초점을 둔다.

- 정리 성공 시 `organized_at`·`organized_page_id`·`organized_operation_id`에 일시·페이지·정리 UUID를 저장한다. 문서·참조 색인·`page_origins` 출처·정리 상태·영수증은 같은 트랜잭션이며 실패하면 원본은 입력함에 남는다. 정리 상태 변경만으로 Capture 내용·버전·생성/수정 시각·첨부·불변 AI 요청과 결과를 바꾸지 않는다.
- 기본 `organization=inbox`는 정리 완료 Capture를 일반 메모·AI 목록·개수·검색에서 제외한다. `/memo`의 **정리 완료**는 `organization=organized`로 원본을 다시 열며 상세의 **입력함으로 되돌리기**가 일반 목록·개수·검색으로 복귀시킨다. 복귀는 현재 `expectedOrganizedOperationId`와 UUID를 검사해 이전 복귀 요청이 새 정리 상태를 해제하지 않게 한다. 복귀 후에도 Page 사본·출처는 남는다. 연결 Page를 휴지통으로 옮겨도 원본이나 첨부를 삭제하거나 자동 복귀시키지 않는다.
- 정리 완료는 휴지통과 별도 상태다. 원본 상세·개인 첨부 API·AI 이력은 계속 조회할 수 있다. 검색의 파일명은 정리 전 활성 소유 메모 또는 활성 참조 Page가 있을 때만 보이고 정리된 소유 메모 대신 활성 참조 Page로 이동한다. 파일 바이트는 유지한다.
- 페이지 정보의 **원본 메모**는 `GET /api/pages/:id/origins`의 출처를 지연 조회한다. 새 출처와 기존 가져오기 영수증·`captureRef` 색인을 함께 사용하며 `/captures/:id` 원본 상세와 선택한 당시 AI 요청·결과를 제공한다. 휴지통 원본은 상태를 표시하고 그 AI 작업은 일반 조회에서 숨긴다. 출처 기록은 본문·검색 평문·Markdown 출력에 자동으로 삽입하지 않는다.
- 기존 `captureRef.props.captureId` 블록은 편집기·Markdown 출력에서 숨기고 원래 블록 JSON은 유지한다. 편집 후 저장도 숨긴 원본 블록을 보존한다. 이전 문서를 자동으로 재작성하거나 기존 메모를 일괄 정리 완료로 바꾸지 않는다. `disposition`을 생략한 API는 이전 복사 계약을 유지하며 같은 UUID의 영수증 재전송은 입력함으로 복귀한 메모를 다시 정리하지 않는다.
- `asset.props.assetId, display`: 기존 파일을 이미지·파일로 재사용한다. JSON에는 저장 키·디스크 경로·파일명·본문 바이트를 넣지 않는다. 대상이 없으면 해당 블록에 안내하고 연결 실패에는 재시도를 제공한다.
- `page_references(page_id, block_id, target_type, target_id)`: capture·asset·page 참조의 파생 색인. 문서 저장과 같은 트랜잭션에서 재구축한다. 최초 마이그레이션은 기존 문서도 색인한다. 새 참조는 대상 존재를 검사하고 기존의 사라진 참조는 다른 글의 저장을 막지 않는다.
- `page_import_operations(operation_id, request, result, created_at)`: UUID·최초 요청·최초 응답을 보관한다. 동일 요청은 최초 응답을 반환하며 같은 ID의 다른 요청은 409다. 문서 한도·소속 오류는 전체 롤백, 없는 대상은 404다. 새 페이지도 실패 시 남지 않는다. 기존 영수증은 정리 상태 전이 없이 재생한다.
- 가져오기는 서버에서 최신 페이지 끝에 추가하고 버전을 올린다. 이미 열린 편집기의 늦은 저장은 409이며 브라우저 초안은 유지한다. 원문·기존 첨부 바이트·상위 본문은 바꾸지 않는다.
- 응답 유실 시 선택을 잠그고 같은 요청을 다시 확인한다. 제출 스냅샷은 현재 탭의 `sessionStorage`에 남아 새로고침 후 복구한다. 요청 전의 미제출 선택은 새로고침 복구 대상이 아니다. 브라우저가 임시저장을 거부하면 현재 화면의 요청 사본으로만 재시도한다.
- 제목 검색은 서버에서 50개씩 더 보기와 전체 계층 경로를 제공한다. 전체 페이지 요약 목록의 200개 제한과 사이드바 깊이 8의 숨김을 제거했다. 깊은 계층의 들여쓰기 폭만 8단계로 제한한다.
- Markdown 보기·복사는 첨부의 설명·앱 전용 ID를 내보내며 원본 메모 카드·출처 메타데이터는 자동 포함하지 않는다. 파일 바이트는 포함되지 않으며 변환 시 안내한다. 별도 공유 서버는 공유된 페이지가 현재 직접 참조하는 첨부만 제공하고, 원본 메모 카드·출처·하위 페이지는 공개하지 않는다. 묶음 내보내기는 아직 없다.

`page_shares`는 페이지별 공개 링크의 토큰 해시·만료·해제 시각을 저장한다. 원본 토큰은 발급 순간에만 보여주므로 잃어버린 링크는 새로 발급해야 한다. 공유 범위와 개발·배포 절차는 [공유와 계획 페이지](SHARING_AND_PLANS.md)에 정리했다.

SQLite의 `page_connection_migrations`는 기존 페이지 참조의 최초 색인 여부만 기록한다. 사용자의 원문이나 파일을 초기화하지 않는다. 참조 색인은 문서에서 다시 만들 수 있고 작업 재시도 기록은 서버 DB 백업에 함께 포함한다.

### 공개 페이지 화면 모드

공유 페이지와 오프라인 HTML은 첫 방문 시 **밝게**로 열린다. 상단 `leneu.` 옆 **화면 모드**에서 밝게/어둡게/시스템을 선택하며 `leneu:share-theme:v1`로 해당 브라우저·공유 Origin에 저장한다. 개인 앱의 모드 설정과 독립적이다. 시스템을 선택했을 때만 OS 변경을 따라가며 저장소를 쓸 수 없어도 현재 페이지의 선택은 적용된다. 작은 `share-theme.js/css`만 추가로 사용하며 오프라인 ZIP에도 포함한다. 이미지의 작성된 색상은 모드와 무관하게 유지한다.

공개 댓글 말풍선은 본문 블록 오른쪽 별도 여백에 둔다. PC는 블록 경계에서 16px, 모바일은 12px 간격과 최소 40×44px 터치 영역을 사용하며 본문 오른쪽 84px에 버튼을 위한 공간을 확보한다. 댓글 선택 윤곽선이 버튼에 붙지 않는다. PC는 공유 댓글의 360px 패널과 오른쪽402px 영역을 처음부터 확보하므로 열기/닫기로 본문 위치·폭을 바꾸지 않는다. 공개 패널 높이는 내용에 맞춰 최대680px 또는 화면 높이까지 늘어나며 긴 대화만 내부 스크롤한다. 이름 라벨은 위에 두고 이름·답글 입력칸을 같은 폭으로 정렬한다. 모바일은 기존 하단62%/88% 패널과16px 입력 글자를 유지한다.

## 휴지통과 복원

- 메모 상세 **휴지통으로 이동**, 페이지 **페이지 정보** 메뉴에서 이동한다. 페이지는 현재 활성 하위 문서도 한 묶음으로 이동하고 확인 단계에 자손 수를 표시한다. 저장 중·실패·충돌·미해결 초안 복구 상태의 페이지는 이동할 수 없다. 응답이 확인될 때까지 해당 기록 편집을 잠근다.
- 사이드바 `/trash`는 전체·메모·페이지 필터와 묶음별 개수, 이동 시각, 한 줄 원문/제목, 44px 복원 버튼을 제공한다. 50개씩 이동 시각·ID 역순 커서로 더 본다. 페이지 묶음의 포함 문서 수는 별도 표시한다. 이동 직후 안내의 **되돌리기**, 목록의 **복원**을 사용할 수 있다. 복원 뒤 열기는 페이지 편집기 또는 해당 메모/AI 요청 목록으로 간다.
- `captures`·`pages`의 nullable `deleted_at`·`trash_id`는 논리 삭제 상태다. `trash_batches`에는 루트와 표시 사본·포함 개수·이동/복원 일시, `trash_operations`에는 UUID·최초 요청·최초 응답을 저장한다. 기존 DB 행은 활성 상태로 마이그레이션한다.
- 원문·블록·AI 요청 사본·첨부 바이트·`createdAt`·`updatedAt`을 보존하고 이동/복원마다 버전을 올린다. 예시 재실행은 휴지통의 기존 예시를 새로 만들거나 되살리지 않는다. 영구 삭제·자동 비우기는 없다.
- 별도로 옮겨 둔 자손은 부모 묶음에 합치지 않는다. 부모가 활성 상태가 아니면 복원되는 문서를 최상위로 옮긴다. 먼저 최상위에 복원한 자손을 부모의 나중 복원으로 다시 붙이지 않는다.
- 일반 목록·개수·검색·연결 페이지·가져오기에서 휴지통 기록을 제외하며 단건 조회·수정은 404다. 기존 원본/페이지 참조는 남아 누락 안내를 표시하며 해당 참조 때문에 다른 본문 저장을 막지 않는다. 이동/복원과 창 집중 시 목록·참조만 갱신하고 이미 열린 편집기의 미저장 내용을 교체하지 않는다.
- 첨부는 활성 소유 Capture/Page, 활성 Page의 본문·남아 있는 수정본 참조 또는 사용자 페이지 템플릿이 있으면 개인 메타데이터·파일 API에서 열린다. 이 조건이 없으면 404이며 바이트는 복원용으로 유지한다. 이 접근 규칙은 개인용 앱의 활성 기록 범위이며 공개 공유 권한은 아니다.
- 이동은 `{operationId, expectedVersion}`, 복원은 `{operationId}`를 보낸다. 동일 UUID·동일 요청은 최초 응답을 돌려주고 다른 요청은 409다. 응답 유실 때 현재 화면의 사본으로 **같은 요청 다시 확인**을 제공한다. 새로고침 후 미확인 요청 사본을 복구하는 UI는 없으며 서버 작업 기록과 휴지통은 재시작 후에도 유지된다. 지연된 이전 요청은 새 생명주기의 기록을 다시 이동·복원하지 않는다.

## 데이터 백업·복원

`npm run backup -- create <data-dir> <backup-dir>`는 Node 24의 SQLite 온라인 백업으로 WAL을 포함한 DB 사본을 만든다. 그 사본의 `assets` 테이블이 참조하는 고유 파일만 `blobs/`에 복사하고 DB 무결성·크기·SHA256을 확인해 `manifest.json`과 함께 최종 디렉터리로 게시한다. 업로드 중인 미등록 임시 파일과 고아 파일은 포함하지 않는다. 등록된 원본 첨부는 현재 서버에서 덮어쓰거나 영구 삭제하지 않는다. 누락·크기 불일치·위험한 키·심볼릭 링크가 있으면 완성 백업을 만들지 않는다.

`npm run backup -- verify <backup-dir>`는 DB·파일·목록을 다시 검증한다. `npm run backup -- restore <backup-dir> <new-data-dir>`는 검증 후 **존재하지 않는** 새 데이터 디렉터리에 복사하고 다시 검사한다. 기존 `data/`를 덮어쓰지 않는다. 대상의 상위 디렉터리는 있어야 하며 원본 안쪽으로 백업하거나 백업 안쪽으로 복원할 수 없다. 백업에는 브라우저 미저장 초안·로컬 최근 선택·실행기 인증·Compose 설정이 포함되지 않는다. CLI 복원은 실행 중인 `data/`를 덮어쓰는 경로를 제공하지 않는다. 원격 보관은 후속 범위다.

### 자동 백업 화면과 예약

사이드바 **백업**(`/backups`)에서 일일 실행을 켜고 한국시간·보관 개수를 저장하거나 **지금 백업**을 실행한다. 기본은 **꺼짐**, 시각 **04:00**, 보관 **7개**이며 보관 수는 1~60개다. 다음 실행·최근 성공·최근 실행(최대 100개)·실패 안내와 새 경로 CLI 복원 방법을 보여준다. 조회 실패는 마지막 확인 상태를 표시하고 설정 초안을 유지한다. 웹에서 운영 자료를 복원하거나 덮어쓰는 동작은 없다.

개인 서버가 1분마다 한국 날짜를 확인하고 활성화한 예약만 실행한다. 서버가 꺼진 동안 놓친 최근 예약은 다음 시작 때 한 번 실행한다. 같은 한국 날짜의 예약은 재시작해도 중복 실행하지 않으며 재시작 당시 진행 중이던 백업은 미완료 실패로 남긴다. 실행·설정 저장은 동시에 처리하지 않으며 실행 중 요청은 409다. 새 백업을 검증해 성공 상태를 기록한 뒤 해당 관리기가 만든 정상 사본만 보관 수에 맞춰 정리한다. 실패해도 이전에 검증한 사본과 수동 CLI 백업·임의 폴더는 지우지 않는다.

`BACKUP_DIR`은 `DATA_DIR`과 같은 경로이거나 서로 조상/자손 관계인 경로를 사용할 수 없다. 두 경로는 어느 쪽도 다른 쪽을 포함하지 않는 별도 디렉터리 트리여야 한다. 기본은 `dirname(realpath(DATA_DIR)) / (basename(DATA_DIR) + '-backups')`이며 기본 `data/`에서는 형제 `data-backups/`다. 예약 설정·이력은 그 경로의 `automatic-backups.json`, 관리 사본의 소유 표시는 `automatic-backup.json`에 보관한다. 심볼릭 링크·위험한 경로는 거절한다. Compose는 개인 `storage`만 `./backups:/backups`를 마운트하고 `BACKUP_DIR=/backups`로 지정한다. 공유 서비스에는 백업 볼륨·API가 없다. 같은 디스크의 사본이므로 다른 디스크/원격 보관은 별도로 구성한다.

## 현재 API

| 메서드·경로                                                  | 동작                                                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                            | 서버 상태 `{ "ok": true }`                                                                                                                                                               |
| `GET /api/maps/config`                                       | 개인 일정용 공개 브라우저 지도 키와 정적 생성 가능 여부 `{googleMapsKey, geoapifyEnabled}`. Geoapify 키 자체는 제공하지 않는다. 미설정은 빈 문자열, 공개 서버에서는 404                                                                                             |
| `GET /api/search?q=&type=all&cursor=`                        | `type=all\|memo\|ai\|page\|file`, 개인 통합검색 20개와 `{items, nextCursor, reset, reason}`                                                                                              |
| `GET /api/trash?type=all&cursor=`                            | `type=all\|capture\|page`, 묶음 50개·전체/유형 개수·다음 커서                                                                                                                            |
| `POST /api/captures/:id/trash`                               | UUID·현재 버전으로 원본 메모를 휴지통으로 이동                                                                                                                                           |
| `POST /api/pages/:id/trash`                                  | UUID·현재 루트 버전으로 페이지·활성 자손을 한 묶음으로 이동                                                                                                                              |
| `POST /api/trash/:id/restore`                                | UUID로 해당 묶음 복원. 단건 이동·복원 응답 `{item: TrashEntry}`                                                                                                                          |
| `GET /api/captures?q=&kind=all&scope=all&organization=inbox` | `scope=all\|memo\|ai`, `organization=inbox\|organized`별 최근 100개·해당 정리 상태의 전체 개수. 범위·정리 상태는 LIMIT 전에 적용. 원문·URL·파일명·당시 요청 입력·템플릿 이름·요청문 검색 |
| `POST /api/captures`                                         | multipart `kind`, `text`, `url`, 선택 UUID `requestId`·JSON `aiRequest: {template, additional}`, `files`를 원자적 저장. 새 저장 201·UUID 재전송 200·`{item, aiJob}`                      |
| `GET /api/ai/status`                                         | 실행기 활성 여부·비밀값 없는 표시 정보·지원 입력·`researchModes` 조회                                                                                                                    |
| `GET /api/ai/activity?view=full&status=all`                  | 메모·Page 실행 현황 `{items, counts, total}`. `view=compact`는 진행 중 우선 3개, `full`은 선택 상태의 최근 50개. 상태는 `all\|active\|result_ready\|failed`, 휴지통 제외·정리 완료 포함  |
| `GET /api/ai-jobs?ids=`                                      | 쉼표로 구분한 작업 UUID 최대 20개의 요약 `{items}`. 활성 Capture 또는 Page만 반환                                                                                                        |
| `GET /api/captures/:id/ai-jobs`                              | 활성 원본의 최신 50개 작업 이력 `{items}`                                                                                                                                                |
| `POST /api/captures/:id/ai-jobs`                             | `{requestId, expectedVersion, retryOf?}`로 보관 AI 요청의 현재 내용 실행 또는 이전 사본 재시도. 201·`{item}`                                                                             |
| `GET /api/ai-jobs/:id`                                       | 활성 원본의 작업·사본·결과 `{item}`                                                                                                                                                      |
| `POST /api/captures/:id/unorganize`                          | `{operationId, expectedOrganizedOperationId}`로 정리 완료 원본을 입력함으로 복귀. 200·`{item: Capture, replayed}`                                                                        |
| `GET /api/pages/:id/origins`                                 | 활성 Page의 새 출처·기존 가져오기/참조 출처 `{items: [{capture, job, operationId}]}`. Capture·job·operationId는 누락/기존 상태에 따라 nullable                                           |
| `GET /api/pages/:id/ai-jobs`                                 | 활성 Page의 최신 50개 작업 `{items}`                                                                                                                                                     |
| `POST /api/pages/:id/ai-jobs`                                | `{requestId, expectedVersion, aiRequest: {template, additional}, blockIds?, retryOf?}`로 저장 Page 전체/선택 요청 또는 이전 사본 재시도. 201·`{item: AiJob}`                             |
| `POST /api/pages/:id/ai-applies`                             | `{operationId, expectedVersion, jobId, mode: 'append' \| 'replace' \| 'child', document, title?}` 명시 반영. 200·`{item: PageRecord, operationId, replayed}`                             |
| `POST /api/pages/:id/ai-applies/:operationId/undo`           | `{operationId, expectedVersion}`로 추가·교체 직전 제목·문서를 새 버전으로 복원. 200·`{item: PageRecord, replayed}`                                                                       |
| `POST /api/pages/:id/capture-imports`                        | 기존 Page에 선택한 원문·첨부·완료 결과 담기. `disposition: 'organize'`면 출처·정리 완료를 함께 저장                                                                                      |
| `GET /api/captures/:id/pages`                                | 활성 연결 Page 목록 `{items}`                                                                                                                                                            |
| `GET /api/assets/:id/info`                                   | 활성 소유자/참조가 있는 파일 메타데이터 `{item: {id, name, mime, size}}`. 저장 키 제외                                                                                                   |
| `GET /api/captures/:id`                                      | 한 입력과 연결된 파일 메타데이터 조회                                                                                                                                                    |
| `PATCH /api/captures/:id`                                    | JSON `text`, 링크일 때 `url`, `expectedVersion` 수정. 버전 불일치는 현재 항목과 함께 409                                                                                                 |
| `GET /api/assets/:id`                                        | 원본 파일 조회·다운로드                                                                                                                                                                  |
| `GET /api/pages`                                             | 위치순 전체 페이지 요약 목록 `items`. 이전 `stagingPageId`도 반환하지만 현재 UI는 사용하지 않음                                                                                          |
| `GET /api/pages/search?q=&cursor=`                           | 가져오기 선택 화면의 페이지 제목 검색·현재 계층 경로·50개 커서. 통합검색과 별도 계약                                                                                                     |
| `GET /api/pages/staging`                                     | 호환 API. 이전 임시 문서 조회. 아직 없으면 `{item: null}`                                                                                                                                |
| `POST /api/pages/staging`                                    | 호환 API. 없으면 한 번 생성하고 있으면 같은 문서 반환. 현재 UI는 호출하지 않음                                                                                                           |
| `POST /api/pages`                                            | `title`, 선택 `icon`·`parentId`로 생성. 선택 `captureImport`와 새 하위 페이지를 원자적으로 생성                                                                                          |
| `GET /api/pages/:id`                                         | 제목·아이콘·블록 JSON·편집 버전 조회                                                                                                                                                     |
| `PUT /api/pages/:id`                                         | `title`, `document`, `expectedVersion`, 선택 `icon` 저장. 버전 불일치는 409                                                                                                              |
| `PATCH /api/pages/:id`                                       | `parentId`·`position`으로 목록 위치·계층 이동. 없거나 순환하는 상위는 400                                                                                                                |
| `GET /api/tasks?status=open&limit=50&cursor=`                | 상태별 목록과 전체 `counts`, `stageCounts`, `nextCursor`. 선택 `stage=todo|doing|done`은 보드 열별 필터이며 커서를 구분한다. 개수는 1~100, 기본 50                                                                                                                         |
| `POST /api/tasks`                                            | JSON `title`, 선택 `dueDate`·`requestId`로 할 일 추가. 같은 UUID의 재시도는 같은 항목 반환                                                                                               |
| `GET /api/tasks/:id`                                         | 할 일 하나 조회                                                                                                                                                                          |
| `PATCH /api/tasks/:id`                                       | 선택 `title`·`dueDate`·`status`·`stage`와 필수 `expectedVersion` 저장. 충돌은 최신 항목과 함께 409                                                                                               |
| `GET /api/prompt-templates`                                  | 저장소 `libraryId`·현재 템플릿 `items`                                                                                                                                                   |
| `POST /api/prompt-templates`                                 | 클라이언트 UUID·전체 필드로 생성. 같은 ID·최초 내용의 재시도는 최초 저장 수정본 반환                                                                                                     |
| `GET /api/prompt-templates/:id`                              | 현재 템플릿 조회                                                                                                                                                                         |
| `PUT /api/prompt-templates/:id`                              | 전체 필드·`expectedVersion`·`expectedRevisionId`로 명시 저장                                                                                                                             |
| `PATCH /api/prompt-templates/:id`                            | `archived`와 두 수정 기준값으로 보관·꺼내기                                                                                                                                              |
| `POST /api/prompt-templates/import`                          | `{schemaVersion: 1, items}` 안전한 일괄 가져오기                                                                                                                                         |

목록 응답은 `{items: Capture[], counts: {memo, ai}}`, 상세·수정 응답은 `{item: Capture}`, 생성은 `{item: Capture, aiJob: AiJob | null}`이다. `counts`는 선택한 정리 상태의 DB 전체 개수이며 검색·종류 필터와 무관하다. 기본 `scope=all`은 이전 API와 호환하고 정리 상태 기본값은 `organization=inbox`다. 잘못된 범위·정리 상태는 400이다. 오류는 `{error: "…"}`이며 수정 버전 충돌에는 `current` 항목도 포함한다. `Capture`는 `id`, `kind`, `text`, `url`, `createdAt`, `updatedAt`, `version`, `files`, `aiRequest`(사본 또는 `null`), `latestAiJob`(요약 또는 `null`), `isSample`, `organizedAt`, `organizedPageId`, `organizedOperationId`를 포함한다. 세 정리 필드는 정리 전 `null`이다. 페이지 출처의 Capture는 `deletedAt`도 반환한다. 내부 `sample_key`는 API에 노출하거나 제출하지 않는다. 파일 항목은 `id`, `key`, `name`, `mime`, `size`를 포함한다.

`AiJob`은 `id`, `requestId`, nullable `captureId`·`pageId`, `targetBlockIds`, `sourceVersion`, `request`, `retryOf`, `status`, `runner`, `result`, `errorCode`, 사용자용 `error`, `createdAt`, `updatedAt`, `startedAt`, `finishedAt`, `stale`을 포함한다. 두 소유자 ID 중 정확히 하나만 존재한다. Page 작업은 `sourceDocument`·`sourceTitle`도 반환하고 Capture 작업의 선택은 빈 배열이다. 기존 작업의 ID·요청·결과·재시도 연결·제출 지문은 이관 후 보존한다. 실행 토큰·지문·비밀값은 반환하지 않는다. 최신 Capture 작업 요약은 `id`, `status`, `sourceVersion`, `errorCode`, `updatedAt`이며 묶음 요약 API는 두 소유자 ID도 반환한다. 잘못된 입력은 400, 버전·UUID 내용·진행 중 충돌은 409, 없는/휴지통 소유 기록·작업은 404다.

통합검색 응답은 `{items: SearchItem[], nextCursor: string | null, reset: boolean, reason: 'short_query' | null}`다. 각 항목은 `id`, `type`(`memo`·`ai`·`page`·`file`), `label`, `snippet`, `icon`, `kind`, `createdAt`, `updatedAt`, `href`, `context`를 포함한다. `label`은 현재 메모 원문/URL 또는 저장된 페이지 제목/파일명이며 `context`는 출처·Page 경로·**실행 전** 안내다. 클라이언트는 커서를 해석하지 않고 그대로 보내며 `reset: true`면 결과를 교체한다. 한도 초과·잘못된 분류·커서는 한국어 `{error}`의 400이다.

현재 상한은 메모 10,000자, 파일당 25MB, 요청당 파일 8개와 합계 100MB다. 100MB는 하루 한도가 아니라 **한 번의 저장 요청**에 적용된다. URL 입력은 `http:`와 `https:`만 받으며 본문 수집은 명시적으로 선택한 AI 리서치 작업에서만 한다.

페이지 제목은 160자, 문서는 1MB·1,000블록까지 받는다. 서버는 허용된 블록 종류·중복 ID·위험한 URL을 검사하고, 페이지 링크 블록의 `pageId`도 형식을 검사한다. 페이지를 다른 탭에서 먼저 저장했다면 409 응답과 현재 서버 버전을 돌려주며, 늦은 탭의 브라우저 초안은 유지한다.

페이지 도구·자동 백업의 개인 API는 다음과 같다. 공개 서비스에는 등록하지 않는다.

| 경로                                                                     | 현재 동작                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `POST /api/pages/:id/duplicate`                                          | `operationId`, `expectedVersion`으로 단일 Page 복제                                         |
| `GET /api/page-templates` / `POST /api/page-templates`                   | 목록 `{items}` / `pageId`, `name`, `operationId`, `expectedVersion`으로 사본 저장           |
| `POST /api/page-templates/:id/pages`                                     | `operationId`, 선택적 `parentId`로 새 Page 생성                                             |
| `DELETE /api/page-templates/:id`                                         | 템플릿 삭제, boolean 반환                                                                   |
| `POST /api/pages/:id/block-moves`                                        | `operationId`, `expectedVersion`, `targetPageId`, `targetVersion`, `blockIds`로 원자적 이동 |
| `POST /api/pages/:id/assets`                                             | multipart `operationId`, `expectedVersion`, 파일로 직접 첨부                                |
| `GET /api/pages/:id/revisions` / `GET /api/pages/:id/revisions/:version` | 수정본 목록 `{items}` / 제목·아이콘·문서 `{item}`                                           |
| `POST /api/pages/:id/revisions/:version/restore`                         | `operationId`, `expectedVersion`으로 과거 문서를 새 버전으로 복원                           |
| `GET /api/backups` / `PUT /api/backups`                                  | 상태 / `enabled`, `hour`, `minute`, `retention` 설정(4KB JSON 한도)                         |
| `POST /api/backups/run`                                                  | 수동 백업 접수(202). 실행 중 409                                                            |

페이지 도구의 잘못된 값·한도·선택은 400, 없는 Page·템플릿·수정본은 404, 버전/UUID 충돌은 409다. 복제·템플릿 저장/생성은 201, 이동·첨부·복원은 200이며 성공 응답은 `{item, replayed}`(이동은 `target`도 포함)를 사용한다.

Task 목록 응답은 `{items: Task[], counts: {open, done}, nextCursor, reset}`이며 저장·상세는 `{item: Task}`다. Task는 `id`, `title`, `status`, `dueDate`, `position`, `createdAt`, `updatedAt`, `completedAt`, `version`을 포함한다. 커서는 조회 위치·목록 변경 번호·필터·한국 날짜를 담는 불투명 문자열로, 클라이언트는 받은 `nextCursor`를 그대로 보낸다. 이전 조회 뒤 목록이 바뀌었다면 첫 페이지와 `reset: true`를 반환하므로 클라이언트는 누적 목록을 교체한다. Task JSON 요청 본문은 16KB까지 받으며 잘못된 제목·날짜·상태·버전·커서는 400, 없는 항목은 404다.

템플릿 단일 JSON 요청은 64KB, 가져오기는 16MB다. ID는 1~80자의 소문자·숫자·하이픈이며 `new`·`import`·`constructor`는 예약값이다. 잘못된 필드·변수·수정 기준은 400, 없는 항목은 404, 충돌은 409와 `current`다. 가져오기 응답 `{libraryId, items, created, updated, unchanged, mappings}`의 매핑은 원본 ID·버전과 대상 ID·**최초 가져오기 시점**의 버전·수정본 UUID를 포함한다. 이후 다른 기기에서 고쳐도 재시도 매핑은 최신 수정본으로 승격하지 않는다.

가져오기 API는 `POST /api/pages/:id/capture-imports`와 생성의 `captureImport`에 `{operationId, captureId, copyContent, assetIds, disposition?, aiResult?}`를 받는다. `disposition`은 생략한 이전 복사 계약 또는 `'organize'`만 허용한다. `aiResult`는 `{jobId, document: {schemaVersion: 1, blocks}}`이며 해당 Capture의 완료 결과만 사용할 수 있다. 응답은 `{item: PageRecord, blockIds: string[], replayed: boolean}`이다. 기존 빈 페이지 생성 응답 `{item}`은 유지한다. `GET /api/pages/search?q=&cursor=`는 `{items: (PageSummary & {path: {id, title}[]})[], nextCursor}`, `GET /api/captures/:id/pages`는 본문 참조 또는 출처로 연결된 활성 페이지의 `{items}`를 반환한다. `GET /api/pages/:id/origins`는 `{items: [{capture, job, operationId}]}`이며 job은 선택한 작업이 없거나 조회할 수 없으면 `null`, 기존 원본 참조의 작업 ID는 `null`일 수 있다. `GET /api/assets/:id/info`는 `{item: {id, name, mime, size}}`이며 저장 키를 포함하지 않는다. 이 경로들은 모두 현재의 개인용 API다.

## 접근 경계와 남은 단계

개발 API와 Compose 포트는 기본적으로 `127.0.0.1`에만 바인딩한다. **개인 API에는 사용자 인증이 없다. 공유 서버는 별도 토큰 검사를 한다.** 따라서 지금 이미지를 인터넷이나 LAN에 직접 공개하면 안 된다. [기술 아키텍처](TECH_ARCHITECTURE.md)의 Tailscale 본인 식별은 이후 구현 단계이며 공개 공유 전용 서비스와 토큰 검사는 로컬에 구현됐다.

현재 개인용 통합검색은 SQLite FTS5로 원문·요청·페이지·파일명·할 일·완료 AI 결과·OCR 텍스트를 찾는다. 페이지 도구·이력·자동 백업·개인 블록 댓글·오프라인 읽기 ZIP·선택한 AI 결과의 할 일 등록·프롬프트 수정본 초안 복원을 구현했다. 실제 OCR 엔진은 선택적 HTTP 게이트웨이 연결이 필요하다. 일반 첨부 이해·전체 오프라인 편집/동기화·공개 도메인/Tailscale 연결·방문자 본인 확인·외부 댓글 알림·원격 백업은 후속 범위다. 현재 단일 파일 업로드 한도는 25MB다.

## 확인 명령

Google 일정 지도는 `npm run qa:google-map`, 활동·이미지 공유는 `npm run qa:static-plan`으로 확인한다. [이전 Google 검증](.omo/evidence/google-map.md)의 206/206·실지도 QA는 당시 개인/공개 지도의 기록이다. 현재 공유는 정적 이미지로 바뀌었으므로 그 기록을 새 공유 구현의 검증으로 사용하지 않는다. 최신 검증은 [이미지 공유 기록](.omo/evidence/itinerary-static.md)을 따른다.

계획·페이지 도구·데이터 보존 확장은 [설계](docs/superpowers/specs/2026-09-30-plan-page-preservation.md)와 [구현 계획](docs/superpowers/plans/2026-09-30-plan-page-preservation.md)을 따른다. `npm run qa:features`는 빌드 후 임시 저장소의 일정·공개 지도·페이지 복제/템플릿/첨부/이동/수정본·자동 백업 화면을 확인하는 대상 QA 명령이다. 최신 결과는 [구현·검증 기록](.omo/evidence/plan-page-preservation.md)에 연결한 전체 Node 203/203·빌드·기존 전체 Chrome QA·최종 기능 QA와 23장 화면 근거를 따른다. 기존 전체 QA 이후의 지도 선택·확대/초점·툴팁·개인/공개 키보드 보완은 최종 기능 QA로 확인했다. [UI 최종 판정](.omo/evidence/plan-page-preservation-ui-verdict.md)은 단일 지도 선택 지적 M1을 resolved·ship으로 확인한 범위다. 더 넓은 화면 범위는 [앞선 전체 리뷰](.omo/evidence/plan-page-preservation-ui-review.md)를 따른다. 이 문서의 아래 테스트 수·스크린샷·리뷰는 이전 확장의 당시 기록이다. [문서 확인 기록](.omo/evidence/plan-page-preservation-documentation.md)은 코드 대조·링크·형식과 기존 디자인 보존 범위만 기록한다.

AI 모니터는 `node --test test/ai-activity.test.mjs`와 빌드 후 `node scripts/qa-ai-activity.mjs`로 확인한다. `QA_AI_ACTIVITY_SCREENSHOTS=0`이면 기존 캡처를 덮지 않는다. 이번 [전체 Node 테스트](.omo/evidence/ai-monitor-tests.log)는 147/147, [수정 후 빌드](.omo/evidence/ai-monitor-build-reviewed.log)와 [대상 브라우저 QA](.omo/evidence/ai-monitor-ui-reviewed.log), [Capture AI 회귀](.omo/evidence/ai-monitor-capture-regression-verified.log)·[Page AI 회귀](.omo/evidence/ai-monitor-page-regression.log)는 통과했다. 임시 저장소·로컬 실행기로 확인했으며 실제 제공자는 호출하지 않았다. 모니터 QA는 네이티브 화면 밖 최초 요청 0건·교차 후 조회·모바일 도크 숨김·실제 로컬 worker 전이·작업 링크·정리 완료 이력·오류 복구·초안 유지·합성 hidden 폴링 중단과 1327/390/320px 밝음·어두움을 검사했다. [수정 verdict](.omo/evidence/ai-monitor-review-verdict.md)는 기존 두 지적의 해결을 승인한 범위이며 새 전체 화면 승인으로 해석하지 않는다. 이번 전체 `scripts/qa.mjs`는 다시 실행하지 않았다. [문서 확인 기록](.omo/evidence/ai-monitor-documentation.md)은 서술·링크·형식·기존 디자인 보존을 별도로 기록한다.

메모 수명 주기·Page AI의 관련 확인 명령은 `node --test test/page-lifecycle.test.mjs test/page-ai-api.test.mjs test/page-document-visibility.test.mjs`와 빌드 후 `node scripts/qa-page-ai.mjs`다. 임시 저장소·로컬 HTTP fixture로 정리 완료/복귀·기존 문서 보존·소유자 이관·입력 사본·명시 반영/되돌리기·버전 충돌·응답 유실 재전송을 확인한다. [이번 문서 확인 기록](.omo/evidence/lifecycle-documentation.md)은 소스·링크·형식 확인 범위이며 전체 테스트 수나 최종 브라우저 QA 판정을 대신하지 않는다. 아래 수치·smoke는 각 이전 확장의 당시 기록이다.

이전 AI 결과 페이지 확장의 [전체 테스트](.omo/evidence/ai-page-tests-final.log)는 131/131이고 [빌드](.omo/evidence/ai-page-build-final.log)는 통과했다. 완료 작업 선택·다른 메모/미완료 거절·반복 제출/재시작·원본/결과 보존·위험 링크/참조/문서 상한·원자적 롤백을 임시 저장소에서 검사했다. [당시 최종 AI 브라우저 QA](.omo/evidence/ai-page-ui-final.log)는 하위 Page·Markdown/표/Mermaid/출처·편집 자동 저장·응답 유실/새로고침/최초 요청 재전송·원본/결과 보존을, [당시 가져오기 QA](.omo/evidence/ai-page-connections-qa.log)는 원문·첨부·하위 페이지·복구·충돌 동선을 통과했다. [당시 독립 코드·UI 리뷰](.omo/evidence/ai-page-review.md)는 Approve·Ship이며 미해결 지적은 없었다. 들여쓰기 보존 수정 뒤 [당시 최종 AI QA](.omo/evidence/ai-page-ui-confirm.log)도 통과했다. 해당 확장은 실제 `data/`와 유료 제공자를 사용하지 않았다. [이전 문서 확인 기록](.omo/evidence/ai-page-documentation.md)을 참조한다.

- `npm test`: AI도 실제 제공자 없이 임시 DB·HTTP fixture·가짜 CLI로 검사한다. 키워드 확장 후 [최종 전체 테스트](.omo/evidence/keyword-tests-final.log)는 123/123이며 URL/자유 요청 회귀·검색 증거 위조/빈 결과·부분/전체 수집 실패·공유 deadline/중단·템플릿 backfill/200개 상한을 포함한다. [최종 빌드](.omo/evidence/keyword-build.log)도 통과했다. 이전 AI 실행의 107/107·native 수명 주기 RED→GREEN은 [이전 문서 검증 기록](.omo/evidence/ai-documentation.md)에 남아 있다.
- `npm run build && QA_AI_SCREENSHOTS=0 node scripts/qa-ai.mjs`: 임시 HTTP 게이트웨이로 저장→상태·결과·복사, 재요청/이력/이전 내용, 실패/재시도, 보이는 목록 갱신·hidden 중단, 응답 유실/새로고침 재제출을 검사한다. 캡처를 새로 저장하려면 `QA_AI_SCREENSHOTS=0`을 생략한다. [AI UI QA 로그](.omo/evidence/ai-ui-qa-final.log)·[전체 QA 로그](.omo/evidence/ai-full-qa-final.log)와 1327/390/320px 밝음·어두움 6장을 확인했다. 일반 QA의 자식 서버는 AI 실행기를 강제로 끄며 제공자 실호출을 하지 않는다.
- `npm run build && node scripts/qa-keyword-research.mjs`: 임시 DB·HTTP fixture로 지연 입력·키워드 선택/미리보기·URL 우선 안내·저장 우선·HTTP 검색 미지원과 요약 미호출·확인 출처/부분 수집 결과·관리 화면을 확인한다. [최종 키워드 UI QA](.omo/evidence/keyword-ui-qa-final.log)는 통과했고 실제 데이터·유료 제공자 호출은 0이다. 기존 [화면 6장](.impeccable/review/keyword-research/)은 1327/390/320px 밝음·어두움이며 마지막 fixture 출처 수 교정은 제품 UI를 바꾸지 않았다. [전체 Chrome QA](.omo/evidence/keyword-full-qa.log)도 통과했다.
- `node scripts/ai-devin-smoke.mjs`: 설치·인증된 Devin의 **명시적 실호출**이다. 일반 테스트·QA에 포함되지 않으며 임시 저장소·합성 입력의 앱 작업 하나를 만든다. 선택적 `DEVIN_BIN`·`DEVIN_SMOKE_MODEL`을 받는다. 이전 [실호출 결과](.omo/evidence/ai-devin-smoke.json)는 당시 모델 `gpt-6-sol-medium`·`result_ready`·원본 보존·실데이터 미사용이며 usage는 `null`이다. 현재 기본 모델 `swe-2-high`나 Page AI의 실호출 검증 기록이 아니며 제공자의 내부 호출 수·정확한 비용·미니PC 실행 검증을 뜻하지 않는다. 당시 검증 범위와 문서 확인은 [이전 문서 검증 기록](.omo/evidence/ai-documentation.md)에 정리한다.
- `DEVIN_SMOKE_RESEARCH=1 DEVIN_BIN=/installed/path/devin node scripts/ai-devin-smoke.mjs`: 외부 계정 사용량·요금이 발생할 수 있는 공개 SQLite 주제의 opt-in 실호출이다. 한 번 실행할 때 임시 저장소·합성 키워드 작업 하나를 만들고 검색·요약 CLI 2회를 실행한다. [키워드 smoke](.omo/evidence/keyword-devin-smoke.json)는 `result_ready`·공식 출처 본문 확인·원본 보존·usage `null`이다. 이전 키워드 확장의 전체 실호출 기록은 초기 [검색 probe](.omo/evidence/keyword-search-probe.json)와 키워드 작업 2개이며 두 번째는 smoke 입력 조건을 고친 실행이다. 작업 수를 제공자 내부 호출 수·과금 한도로 해석하지 않는다. 승인된 [리뷰](.omo/evidence/keyword-review.md)와 전체 [검증 기록](.omo/evidence/keyword_research.md)을 참조한다.

- `node --test test/search.test.mjs test/search-api.test.mjs`: 임시 저장소의 연속 구문·필드 경계·NFC/리터럴·표/링크/자식/Mermaid, 원자성·backfill·v2 이관·재시작, 휴지통/복원·재사용 파일 가시성, 커서 리셋·HTTP 검증을 확인한다.
- `npm run build && QA_SEARCH_SCREENSHOTS=0 node scripts/qa-search.mjs`: 임시 저장소의 Chrome 통합검색·키보드·합성 조합 Enter·초안/초점 보존·지연 첫/더 보기 응답·필터·리셋·실패 재시도를 확인한다. 스크린샷을 새로 저장하려면 `QA_SEARCH_SCREENSHOTS=0`을 생략한다. 전체 `npm run qa`에도 포함된다.
- `node scripts/benchmark-search.mjs`: 임시 1만·10만 혼합 자료의 일치 개수·저장소 호출 p50/p95·저장·색인/DB 크기·재시작·RSS를 측정한다. `BENCH_SEARCH_SIZES=10000,100000`·`BENCH_SEARCH_REPORT=/tmp/search-report.json`으로 크기·보고서 경로를 정할 수 있으며 실제 데이터 경로는 받지 않는다. 이전 검색 확장에 기록된 전체 테스트 77/77·빌드·scoped/full Chrome QA와 1327/390/320px 양쪽 테마 6장은 [검증 기록](.omo/evidence/unified_search.md)에 연결한다. 네이티브 OS IME·N100은 미측정이다.

- `node scripts/qa-page-connections.mjs`: 빌드 후 임시 저장소의 기존/새 하위 페이지 담기, 선택 첨부·Markdown ID·원본 직접 열기/새로고침, 응답 유실/새로고침 재시도, 오래된 편집기의 충돌 초안, 1327/390/320px 양쪽 테마를 확인한다. 전체 QA에도 포함된다.

- `npm test`: 이전 임시 문서 API 호환, SQLite 보존·파일 연결, Capture·Page·Task 버전 충돌·검증, Task 기한·목록·중복 재시도, 한국 시간과 `NEW`, 프롬프트 치환·불변 수정본·생성/가져오기 재시도·충돌·일괄 롤백·JSON 크기, 초안 복구·탭 구분·최근 선택, AI 요청 사본·범위별 LIMIT·당시 입력 검색·multipart 실패 롤백·예시 재실행 보존을 검사한다.
- `npm run qa`: 임시 저장소에서 Chrome으로 입력함 수정·충돌, 페이지 Markdown·Mermaid·저장, 할 일 추가·수정·완료·되돌리기·실패·연속 체크·많은 목록·초안·모바일·테마, 프롬프트 관리·요청 미리보기·실패·다른 탭 충돌·320/390px 배치를 검사하고 화면을 빌드한다. 템플릿 미리보기는 URL이나 AI 제공자에게 요청하지 않는지, AI 저장은 실행기 미연결 실패와 원본 저장 성공을 구분하는지 검사한다. `scripts/qa-server-prompts.mjs`는 독립 브라우저·연결 재시도·늦은 저장·브라우저 초안 이관·백업 보존·JSON 교환·양쪽 테마를 검사한다. `scripts/qa-prompt-recovery.mjs`는 생성 응답 유실·수정/새로고침 후 재시도·독립된 두 초안 유지·가져오기 중 선택 변경·브라우저/서버 초안 합산·손상 원본 보존을 검사한다. `scripts/qa-compact-pages.mjs`는 일반 페이지 재진입·편집 보존·상단 공간·모바일 메뉴의 화면 모드를 검사한다. `scripts/qa-memo-library.mjs`는 범위별 목록·지연 응답·요청문 복사·수정·재접속·이전 주소·홈 초안과 실제 예시를 검사한다. 기존 Google Fonts 파일 요청은 허용한다.
- `npm run build && node scripts/qa-tasks.mjs`: 할 일 브라우저 시나리오만 별도의 임시 저장소에서 실행한다.
- `scripts/qa-shell-recovery.mjs`는 전체 QA에 포함되어 빈 502·HTML 200 목록 응답의 한국어 오류와 재시도, 메모 초안 보존, 로고 옆 전체 한국 날짜와 설정 모달의 화면 모드, 1327/390/320px의 밝은·어두운 화면을 검사한다.
- 전체 QA의 `scripts/qa-drafts.mjs`는 즉시 새로고침, 첨부 바이트 복구·실제 보관, 탭별 메모, 성공 후 비움, 저장 중 새 입력 보존, 미저장 템플릿 복구·최근 선택, 모바일 본문·하단 저장·가로 넘침을 검사한다.
- `docker build -t leneu-storage:local .`: 현재 이미지 빌드 확인.

## 2026-09-30 배포 전 완성 항목

- 개인 댓글: `GET/POST /api/pages/:id/comments`. 문서 버전과 독립된 스레드 버전·UUID 영수증으로 충돌과 재전송을 처리한다.
- 오프라인 사본: `GET /api/pages/:id/export?version=N`. 현재 문서와 직접 참조 첨부만 스트리밍 ZIP으로 묶는다. 버전·활성 문서·파일 경로·누락을 응답 전 검사한다. 최대 500개 첨부/200MB. ZIP의 HTML·이미지·파일은 네트워크 없이 읽으며 외부 장소 링크는 연결이 필요하다. 하위 페이지, 댓글, AI 이력, 앱 전체 오프라인 편집/동기화는 포함하지 않는다.
- AI 결과의 할 일 채택: `POST /api/ai-jobs/:id/tasks`. 사용자가 선택·수정한 항목만 원자적으로 등록하며 같은 요청 UUID의 재전송은 중복 생성하지 않는다. 완료 결과와 원문은 유지한다.
- OCR: `GET /api/ocr/status`, `GET/POST /api/assets/:id/ocr`, `GET /api/ocr-jobs/:id`. PNG/JPEG/WebP 최대 5MiB, 별도 단일 실행 큐와 이력. 원본과 독립된 텍스트 결과를 보존한다. 연결되지 않은 실행기는 화면에 안내하며 자동 전송하지 않는다. 외부 게이트웨이 계약은 [배포 안내](docs/DEPLOYMENT.md)에 있다.
- FTS 통합검색: 기존 원문/문서/파일명/요청 외에 할 일·완료 AI 결과·OCR 텍스트를 추가했다. 검색한 작업/결과 ID로 이동한다. 삭제·복원·원본 활성 범위는 쓰기 트리거와 조회 권한에서 함께 검사한다.
- 프롬프트 이력: `GET /api/prompt-templates/:id/revisions`. 과거 요청문을 초안으로 불러온 뒤 명시적으로 저장하면 새 수정본을 만든다.
- Compose 개인/공유 헬스체크와 `compose.n100.yaml`의 Linux/amd64 설정. 실제 장비·외부 접근 검증은 [배포 안내](docs/DEPLOYMENT.md), 로컬 검증 수치는 [검증 기록](.omo/evidence/predeployment/REPORT.md)에 기록한다.

## 서버 이전 전 통합 마무리 (2026-09-30)

- **공유 댓글 받은함:** `server/sharedCommentInbox.mjs`가 방문자 메시지의 단조 증가 sequence/읽음 marker를 보관한다. 페이지 원문을 홈에서 읽지 않으며 최근순 cursor 목록과 대화 수를 반환한다. `/comments`와 홈 카드에서 열고 실제 불러온 선택 대화의 마지막 방문자 메시지까지만 읽음 표시한다. 실패/동시 새 댓글은 미확인으로 유지한다. 해결 상태는 별도다.
- **모바일 수집:** `/capture.webmanifest`와 좁은 `/capture/share` POST service worker가 공유 내용을 IndexedDB 대기함에 보관한다. 기존 초안에 검토 후 병합하고 첨부·글 저장이 확인된 다음에만 대기함을 소비한다. 기존 내용/파일을 덮지 않고 실패 시 원본을 유지한다. 전체 앱/API cache는 만들지 않는다. 배포 개인 주소는 HTTPS를 사용하며 iOS Safari의 OS 공유 수신/실제 휴대폰 검증은 포함하지 않는다.
- **일정 연결:** `server/planConnections.mjs`와 `PlanConnectionsProvider`가 저장된 페이지/블록/항목에 할 일·메모·페이지를 연결한다. UUID 영수증·원문/연결/Task 버전 검사를 한다. 기존 Task 상태를 갱신하고 페이지 문서/수정시각은 바꾸지 않는다. 공개/ZIP은 명시 선택한 활성 할 일의 제목/상태만 투영하며 사적인 관계 ID·원본 자료는 제외한다.
- **이전 산출물:** 같은 Docker 이미지에 운영 백업 CLI를 포함하고 영속 데이터/백업 경로·루프백 포트를 환경 설정으로 지정한다. `migration:check`는 비밀을 출력하지 않고 경계/HTTP 상태를 확인한다. `qa:docker-share`는 실제 임시 Compose의 IPC 댓글·재시작·백업/복원과 복원된 새 경로의 서비스 시작까지 확인한다. 대상 N100/SSH/DNS/Tailscale/Tunnel/실제 재부팅은 여기서 실행하지 않는다.

[설계](docs/superpowers/specs/2026-09-30-migration-ready-design.md) · [계획](docs/superpowers/plans/2026-09-30-migration-ready.md) · [이전 안내](docs/DEPLOYMENT.md) · [검증 기록](.omo/evidence/migration-ready/REPORT.md)

## 생산성 탐색과 메모 함께 정리 (2026-10-01)

- 즐겨찾기는 페이지 상단 별 버튼(모바일 더보기)으로 지정하며 일반 사이드바 페이지 행에는 별 버튼을 두지 않는다. 사이드바 상단 **즐겨찾기**, 홈 **이어서 작업**은 개인 `page_workspace` 메타데이터를 사용한다. 즐겨찾기 저장은 최대 100개, 각 탐색 목록은 최대 8개이며 홈은 최근 열람/즐겨찾기 각 3개다. 최근 열람은 홈에만 표시한다. Page 본문·버전·수정일은 바꾸지 않는다. 휴지통 문서는 숨기고 복원 시 기존 개인 설정을 유지한다.
- `GET /api/workspace/pages`, `POST /api/pages/:id/workspace` (`favorite`/`visited` boolean)는 개인 API다. 공유 서비스에 탐색 API를 노출하지 않는다. 성공한 페이지 열람만 기록하고 연결 실패 시 기존 탐색 목록과 재시도를 남긴다.
- 페이지 트리 행의 이동 버튼과 문서 메뉴 **페이지 이동**에서 상위 페이지를 명시적으로 고른다. 자기 자신과 자손은 목적지에서 제외한다. 기존 드래그 이동도 유지하며 오류·재시도를 표시한다.
- `/memo`는 화면 1101px 이상에서 목록 옆에 상세를 표시한다. 그 아래는 기존 상세 화면이다. **이전·다음**은 현재 로드된 목록에서만 이동한다. 메모 수정·저장·정리·삭제 요청 중 다른 메모/화면 이동을 막고 새로고침에는 브라우저 경고를 사용한다.
- 입력함 일반 메모에서 **메모 선택 → 한 페이지에 정리**로 최대 20개를 새/기존 Page에 담는다. 각 메모의 원문·링크·첨부를 선택한다. AI 요청 원본은 함께 정리 대상에서 제외하며 AI 결과는 기존 명시적 반영 흐름을 따른다. 본문에 메모 참조 카드를 자동 삽입하지 않는다.
- `POST /api/capture-batches/organize`: `operationId`, 새 Page `title/parentId` 또는 기존 `pageId/expectedPageVersion`, `items[{captureId,expectedVersion,operationId,copyContent,assetIds}]`. 모든 원문/자산 선택·버전과 Page 크기를 검사하고 한 트랜잭션으로 Page·출처·정리 상태·영수증을 저장한다. 하나라도 실패하면 전체를 되돌린다. 원문·첨부 소유권/바이트·Capture 버전은 보존한다.
- 정리 제출 사본은 탭의 `sessionStorage`에 유지한다. 응답 유실 시 **같은 요청 확인**으로 재시도한다. 불변 SQLite 영수증은 이미 성공한 요청을 중복 적용하지 않는다. 이후 Page 수정이나 메모 입력함 복귀를 재시도가 덮어쓰지 않는다.
- `⌘K/Ctrl+K`의 **기록 검색 / 빠른 작업**을 분리했다. 새 메모·Page·할 일·AI 요청과 현재 Page 목차·이동·즐겨찾기를 연결한다. 한글 조합 Enter는 실행하지 않는다. 이 팔레트는 편집기와 Mermaid를 초기 입력 번들로 가져오지 않는다.
- 선택 블록의 이동/AI 도구는 스크롤 중에도 화면 위에 남는다. 페이지 메뉴는 작성·정리 / 문서 관리로 나뉜다. 일반 문단/인용은 읽기 폭을 제한하고 일정·지도·표는 넓이를 유지한다. AI 실행 화면은 **AI 작업**, 메모의 별도 탭은 **요청 원본**으로 구분한다. 프롬프트·휴지통·백업은 **관리 도구**에서 연다.
- 홈 모바일 순서는 빠른 입력 → AI·할 일 현황 → 이어서 작업·최근 문서 → 공유 댓글이다. 결과 준비는 사용자의 검토/반영 완료를 뜻하지 않는다.

검증: `node --test test/capture-batch.test.mjs test/workspace-pages.test.mjs test/workspace-commands.test.mjs`, `node scripts/qa-productivity.mjs`, `node scripts/qa-workspace-navigation.mjs`. QA는 임시 데이터 디렉터리를 사용하며 실제 AI 실행과 실제 `data/` 초기화를 하지 않는다.

### 홈 카드 정렬 보완 (2026-10-01)

PC의 이어서 작업 영역은 대시보드 두 열에 걸친 별도 행이다. 그 다음 행의 새로 담기·할 일 카드는 같은 상단 기준으로 시작한다. 1100px 이하에서는 이어서 작업을 입력·현황 뒤로 배치하는 순서를 유지한다.

### 일정 공유 경로 링크 (2026-10-01)

개인/공유/오프라인 사본의 정적 일정 이미지 아래에 **Google Maps 경로**를 표시한다. 같은 날짜에서 장소/좌표가 있는 방문을 작성 순서로 연결하며 이동 활동은 제외한다. 일정 번호와 링크 번호를 일치시킨다. 날짜를 넘겨 연결하지 않고 장소가 2개 미만이면 경로 링크를 만들지 않는다. 모바일 호환을 위해 링크 하나당 최대 5개 장소(경유지 3개)로 나누고 경계 장소를 다음 링크의 시작점으로 재사용한다. 인코딩된 URL은 2,048자 이내로 제한하며 두 장소만으로도 초과하면 해당 구간 링크를 생략하고 개별 장소 링크는 유지한다.

링크를 누를 때 외부 Google Maps가 열리며 API 키·SDK·페이지 로드 시 지도 요청을 추가하지 않는다. 이동 수단/실제 이동 시간/경로 계산은 Google Maps에서 확인한다. 등록 이미지와 자동 방문 순서 이미지의 클릭은 이미지 열기/다운로드로 통일했고 경로 링크와 구분한다. 이미지 로딩 실패에도 일정·개별 장소·경로 링크는 남는다. 자동 도로 지도 캡처나 오프라인 경로 계산은 제공하지 않는다.


### Geoapify 정적 지도 생성 (2026-10-01)

- 개인 `POST /api/pages/:id/map-images`는 `{operationId, expectedVersion, blockId, style}`를 받아 저장된 일정에 대해서만 실행한다. 스타일은 `klokantech-basic`(UI 기본), `osm-bright-smooth`, `osm-liberty`, `positron`, `dark-matter`다. 기본 스타일과 지역명 강조 스타일은 fit zoom에서 0.8단계 줄여 주변을 포함하고 지역명/주요 도로의 색·글자 크기를 조정한다. 기본은 평면 건물과 Noto Sans Regular 지역명(자간 기본 0)을 사용하며, 지역명 강조는 기존 Bold 지역명·건물 그림자 숨김을 유지한다. 다른 스타일의 기존 범위/표현은 유지한다. `server/geoapifyMaps.mjs`는 고정 HTTPS 호스트·POST·30초 제한을 사용하며 외부 오류/요청 URL/키는 클라이언트에 전달하지 않는다.
- 실제 도로 배경, 방문 번호 핀, 같은 날짜의 연속 방문을 잇는 직선 화살표 PNG다. 실제 도보/차량 경로 계산이 아니다. 입력은 최대 50개, 위도 ±85, 날짜 변경선을 건너는 일정은 별도 지도로 나눈다. Mercator 512px world로 범위를 맞추고 핀 주변 여백을 남긴다. 논리 900×560, density 2로 1800×1120 PNG를 만들며 8MB/2048px 응답 상한을 검사한다. POST 핀은 실이미지에서 확인한 `material`·`large`·`textsize:medium`을 사용한다.
- 생성 전 저장 버전·블록·UUID를 검사하고 `map_image_daily_usage`에 UTC 일자별 요청을 예약한다. 기본 하루 20회 **시도** 상한이며 실패한 외부 호출도 포함한다. 제공자의 크레딧 한도와 다르고 직접 외부 호출에는 적용되지 않는다. 동일 진행 요청은 합치며 성공 영수증을 재전송해도 다시 생성하지 않는다. 생성 중 문서 변경은 결과를 적용하지 않고 새 파일을 정리한다.
- 결과는 `data/blobs`의 PNG와 Page 소유 asset, 해당 일정의 `assetId`, `imageSource:geoapify`, `imageInput` 방문 좌표/순서 사본으로 저장한다. 다른 본문/시간표/기존 파일은 보존하고 수정 이력·참조 계약을 사용한다. 이미지 재선택은 현재 문서에서 동일 asset의 Geoapify 메타데이터를 복원한다. 좌표/날짜/번호가 바뀌면 개인·공유에서 갱신 안내만 표시한다.
- 키는 `.env` 및 개인 Compose 서비스에만 전달한다. 브라우저/DB/공유/오프라인에는 넣지 않는다. 조회·공유 시 지도 외부 호출은 없으며 원본 이미지의 출처와 별도 Geoapify/OSM/OpenMapTiles 링크를 유지한다. 앱 전체 오프라인 편집·좌표 자동 검색은 제공하지 않는다.
- `.itinerary-visual`의 sticky 배치를 제거해 이미지와 문서가 같은 속도로 스크롤한다. Google 개인 SDK의 기존 cooperative 제스처는 유지한다. [검증 범위와 실제 샘플](.omo/evidence/geoapify-map/REPORT.md).

지도 읽기 보완은 [현재 검증](.omo/evidence/geoapify-map-polish/REPORT.md)의 실제 기본 스타일과 비교 이미지·대상 브라우저 QA를 따른다. 주변 지역 라벨은 제공자 데이터에 있는 이름을 사용하며 없는 Google 장소 정보를 추정해 채우지 않는다.

### 지도와 시간표의 읽기 배치 (2026-10-01)

개인/공유/오프라인 모두 지도·시간표를 나란히 나누지 않고 한 열로 읽는다. 지도는 문서 폭과 원래 비율을 사용하며 360px 이미지 높이 상한은 제거했다. 기본 klokantech-basic의 공원/숲은 연초록, 물은 파랑, 주요 도로는 옅은 노랑으로 지형을 구분한다. 번호/지역명/방향과 normal-flow 스크롤·공개 키 격리 계약을 유지한다. [확인 기록](.omo/evidence/geoapify-map-flow/REPORT.md).

### 정적 지도 한글 타이포그래피 (2026-10-01)

기본 **주변 지역·도로**는 `klokantech-basic`이다. 제공자 style.json의 `place_label_other`는 Noto Sans Regular·기본 자간을 사용한다. 지역명 논리 16px·도시 18px·도로 13px·장소 12px와 역할별 색을 적용한다. 기존 `osm-bright-smooth`는 **지역명 강조** 선택으로 유지하며 재시도 UUID도 두 스타일 모두 복구한다. PNG에 그려진 텍스트는 웹 CSS 폰트로 변경되지 않는다. Static Maps API의 layer/color/size 범위를 지키며 임의 font-family/font-weight/letter-spacing을 전송하지 않는다. Google의 서체나 장소 데이터와 동일하다고 주장하지 않는다. [공식 API](https://apidocs.geoapify.com/docs/maps/static/)·[검증 기록](.omo/evidence/geoapify-map-type/REPORT.md).

### 지도 장소 이름·일정 조작·댓글 배치 (2026-10-01)

`staticMapStops`는 정적 지도와 동일한 좌표 방문만 추출하고 번호 간격을 보존한다. 저장된 장소/제목과 시각·장소 Google 링크를 개인·공유·오프라인에 공통으로 표시한다. 제공자 지도의 POI 표시는 이름 유무·rank·줌·라벨 충돌/스타일 조건에 따르므로 일정 장소 이름을 그 표시에 의존하지 않는다. 현재 klokantech-basic의 poi_label은 zoom≥14·rank=1인 점을 선택한다. 다른 지역의 누락 원인을 모두 단정하지 않는다.

저장된 지도의 설정은 접어서 표시하고 이미지 없음·stale·진행은 자동으로 연다. 저장/에디터 읽기 잠금의 전환 때문에 조작 컴포넌트가 영구 제거되지 않도록 context 상태로 버튼을 제어한다. 댓글 읽기 모드에서는 CSS로 설정을 숨긴다. 지도 출처는 접는 링크, 크게 보기와 번호별 장소 목록은 이미지 실패 때도 남는다. 서버 렌더링은 장소/제목/URL을 escape하며 공유에는 새 API/지도 SDK/키를 추가하지 않는다.

댓글 버튼은 문서 내부 56px 전용 여백과 44px 폭으로 배치한다. 실제 일정 표면 시작을 기준으로 측정하며 99개 초과는 시각적으로 99+로 줄이고 aria-label은 실제 개수를 유지한다. 넓은 PC의 370px 보조 영역은 평상시에도 확보하여 패널 열기/닫기 때 본문 위치를 유지한다. [확인 기록](.omo/evidence/plan-map-ux/REPORT.md).

### 여행 문서의 읽기 구조 (2026-10-02)

일정은 `shared/itineraryReading.ts`의 날짜별 시간 범위·요일·방문 수와 전체 메모 줄을 개인/공유가 함께 사용한다. 시간 열은 제목·설명의 높이를 강제로 늘리지 않으며, 제목/유형·장소·링크·전체 메모 순으로 읽는다. 설명은 접거나 줄 수로 잘라 숨기지 않고 한 번만 표시한다. 명시된 줄바꿈을 보존하며 HH:mm–HH:mm으로 시작하는 수속 단계는 시간과 지시를 나눠 읽는다. 개인 준비/관련 항목은 별도 조작으로 유지한다. 이 규칙은 새 저장 형식을 만들지 않고 기존 일정 JSON version 1에 적용한다. 공통 읽기 CSS는 `public/itinerary-timetable.css`이며 개인 편집기에서도 가져오고 공유 서버의 명시된 정적 파일/오프라인 ZIP에도 포함한다.

`tableOfContents`의 선택적 `props.compact`는 기본 false다. true이면 이름을 유지한 2열 목차이고 기존 문서는 목록을 유지한다. 공개 HTML에서도 공개 제목 블록의 앵커를 사용한다. 기존 `toggleListItem`은 공개에서 자식을 밖에 늘어놓지 않고 native details/summary 안에 한 번 렌더링한다. 날짜별 일정부터 보여주고 준비·출처를 접어 보관하는 여행 페이지에서도 전체 본문·Markdown·첨부를 보존한다.

블록의 ProseMirror 노드 선택과 일정 행 선택은 바깥 여백 pointerdown으로 해제한다. 댓글 패널·도구 메뉴를 누를 때는 작업 대상 선택을 보존한다. 빈 여백을 누르면 댓글 블록 강조도 해제되며 댓글 초안은 기존 저장 규칙을 따른다.

간사이 여행 문서의 목차는 사용자 요청으로 compact=false인 기존 한 열 카드로 복원했다. 공개·오프라인의 목록 목차도 같은 읽기 형태를 제공한다. 목차라는 이름뿐 아니라 배치/배경/구분선/우측 화살표를 유지한다.

### 일정 직접 편집 (2026-10-02)

`ItineraryInlineField.tsx`는 읽던 시간표의 한 속성만 입력으로 바꾸고 `itineraryInline.css`는 그 위치의 글자 크기·자동 높이·테마를 유지한다. 별도 전체 입력 폼이나 일정 수정 버튼은 없다. 행의 ··· 메뉴에는 날짜·링크·좌표·위/아래 이동·삭제, 블록 ···에는 지도 이미지 선택이 있다. 좌표는 두 값을 함께 검증하는 적용 버튼을 사용하며 취소하면 저장된 좌표로 돌아간다. 신규 일정은 다음 시간·같은 날짜의 새 행으로 추가해 제목에 초점을 준다. 항목 ID·지도의 asset/source/input·준비 연결은 유지한다. 지도는 편집 중 계속 보이고 갱신 API는 자동 호출하지 않는다. 미확정 값은 원문/이미지 기준의 기존 일정 초안 키에 보관한다. 수정 중 AI/공유/페이지 도구 잠금은 기존 이벤트로 유지하며 임시 데이터 Chrome QA는 `node scripts/qa-itinerary-inline.mjs`다.


### 여행 공유서 읽기 정리 (2026-10-02)

간사이 문서는 기존 블록 ID·일정 ID/시각·정적 지도·출처를 보존해 개요/예산 가정·4일 동선·예약/준비 현황부터 읽도록 재배치했다. 항공은 미발권 후보, 숙소는 예약 확인 전으로 명시하고 교통 설명은 해당 이동 행에 노선/환승/소요/비용과 주의 문장으로 표시한다. 문서의 무관한 예시 Task 연결만 해제했으며 원본 Task는 보존했다.

`PlanConnections`는 기본 summary에서 실제 제목·체크박스/참고 링크를 보여주고 빈 항목이면 렌더링하지 않는다. manage는 일정 행 ··· 메뉴에서 기존 연결/생성/공유 선택/해제·UUID 재시도를 제공한다. 불러오기 오류는 첫 항목에 다시 확인을 제공한다. `publicPage.mjs`의 rich 목록은 하나의 본문 span으로 서식 순서를 유지하고, 텍스트의 명시 줄바꿈은 HTML 이스케이프 뒤 br로 변환한다. 공개/오프라인 모두 같은 렌더러를 사용한다. [이번 변경·검증 기록](.omo/evidence/trip-clarity/REPORT.md).

### 문서 중심 읽기·연속 편집 보완 (2026-10-02)

위 개요 우선 구성은 사용자 피드백으로 변경했다. 간사이 문서 v16은 날짜·미예약 안내 → 기존 목록 목차 → 4일 지도/시간표 → 예약·준비 → 예산·도움말 순서다. 전체 동선·예산 가정은 예산의 참고 토글로 옮겼다. 187개 블록 ID, 57개 일정 ID/시각/좌표, 지도 4개의 asset/source/input과 출처 114개를 보존하고 15개 설명의 기존 사실을 역할별 줄로 정리했다. 추가 여행 사실 조회나 예약 확인은 수행하지 않았다.

`itineraryNoteLines`는 명시적인 `노선 ·`, `비용:`, `주의 ·` 등의 접두어만 라벨로 읽는다. 개인·공유·오프라인에서 전체 설명을 그대로 표시한다. 일정은 외곽 카드 대신 행 구분선으로 읽으며 본문 14px/제목 15px(모바일14px), 문서 H2 24px/H3 20px/행간1.65를 적용한다. `ItineraryInlineField`에서 Tab/Shift+Tab은 검증 후 보이는 다음/이전 속성을 즉시 편집하고 잘못된 값은 현재 필드에 남긴다. 설명 textarea는 진입 전 읽기 높이를 최소 높이로 유지한다. 사용법은 일정 설정 메뉴에 있다. [확인 기록](.omo/evidence/document-flow/REPORT.md).


### 2026-10-02 작업 화면 다듬기

홈·메모·할 일·AI·공유 댓글의 가독성과 빈 목록 후속 동작을 개선했다. 본문 14px/보조 12px, 메모 행 구분선, 칸반 열 표면·제목 줄바꿈, 모바일 이어서 작업 상단 배치를 적용했다. API·DB 스키마·폴링·드래그 저장 규격은 변경하지 않았다.

메모 검색/종류 필터 초기화는 검색어와 종류만 지우고 현재 원본 탭/정리 상태를 보존한다. 정리 완료의 빈 화면에서는 입력함으로 이동할 수 있다. AI의 빈 상태에서 다른 작업이 있는지는 선택 필터의 `total`이 아닌 `counts` 합으로 판단한다. 결과 보기 링크는 기존 정확한 `aiJob`을 유지한다. 미확인 댓글이 없고 미해결 대화가 있으면 해당 필터로 이동하며 자동 읽음 처리는 하지 않는다.

검증과 화면은 `.omo/evidence/workspace-refinement/`에 기록한다. `scripts/qa-workspace-refinement.mjs`는 GET 응답 fixture와 쓰기 차단으로 복구 동작·키보드 초점·정확한 결과 링크를 확인한다. 실제 사용자 저장소를 seed하지 않는다.

## 오프라인·동기화 현재 구현 (2026-10-03)

이 절은 앞의 온라인 autosave/초안 설명 중 기기 저장 경로를 대체한다. 전체 계약은 [사용 안내](docs/OFFLINE_USAGE.md), 검증 근거는 [보고](.omo/evidence/offline-workspace/REPORT.md).

- `server/sync/`: protocol1/workspace UUID/epoch, additive sync_meta/changes/receipts/uploads, 원자적 mutation+receipt, tombstone/readSeq, bootstrap 및 본문 없는 페이지 metadata 읽기. private 전용. 기존 REST 쓰기도 DB trigger로 변경 피드를 갱신한다. 명시 backup restore만 epoch를 변경한다.
- `src/sync/`: IndexedDB v2 entities/entitySummaries/outbox/blobs/conflicts/pins/meta/leases. base/current/remote/불변 in-flight와 localRevision 분리. lease30초/갱신10초/fence, 재시도2/5/15/30/60초 ±20%, Retry-After 최대5분. JSON15초/파일60초, 가시 폴링30초. 고정 UUID+본문 hash로 중복 방지.
- 페이지 local commit250ms/queue750ms, 최신 revision의 late ACK 보존; 재시작 시 큐 없는 dirty 사본 복구. 단일 문서 버전 비교와 양쪽 보존. CRDT/자동 병합 없음. 메모50개 keyset 페이지, tree 초기50+추가 표시/선택 경로 보존. 목록 projection에는 페이지 본문 없음.
- 파일25MiB/합계100MiB/8개, 문서1MiB/작업1100KiB. raw upload stage/consume/replay. 직접 첨부 보관200MiB 예산, partial/retry/last-success 유지. 보관 해제 시 미전송/충돌/다른 페이지/복구 기록의 참조 보존.
- root SW와 manifest는 정적 파일 및 lazy editor chunk를 hash 검증 후 보관한다. 개인 navigation만 fallback. API/share/외부 URL을 cache하지 않는다. 기존 share-target 수신 원문 보존. 자동 skipWaiting/claim 없이 기기 저장 뒤 명시 업데이트.
- offline 검색은 기기 메모/할 일/본문 캐시 페이지/파일명이며 scope=local 표시. 서버 전체·OCR/완료 AI 결과 전문의 offline 검색은 지원하지 않는다.
- 단일 memo organize/AI submit·Page AI submit은 immutable 원본/템플릿 및 CRUD receipt 의존성으로 큐에 저장. 기기 대기는 서버 job 상태와 분리. 일괄 organize/unorganize/결과 적용/undo·공유·댓글·지도·휴지통·관리 쓰기는 online/pending 가드.
- 서버 identity/epoch 또는 cursor 역전 시 큐 중지. 원문·첨부 SHA256 ZIP export, explicit review/rebootstrap, 선택한 fresh operation. 이전 AI/정리는 자동 재실행하지 않는다. 다른 workspace 파티션 유지. ZIP 자동 가져오기 없음. quota/upgrade blocked/version mismatch에서 원문 보존·오류 안내.

Offline production 의존성 추가 없음. QA는 기존 Playwright/Vite esbuild 사용. 실제 원문·첨부를 reseed/reset하지 않았다. 실행 중인 서버의 additive schema migration은 기존 data에 적용되며 원문을 삭제하지 않는다. 실제 Oracle/Tailscale/TLS·휴대폰·ARM64/N100 성능은 미검증이다.


#### 오프라인 최종 검증 보강

동일 기기 경쟁 편집은 `localRevision` 원자 비교와 `localEditConflict` 사본으로 보존한다. 취소 요청은 원자적 claim 실패 시 upload/apply하지 않는다. canonical 응답에 workspace/epoch가 포함되고 remote ingress/cache commit에서 다시 확인한다. persisted recovery pause는 명시 재연결 전 전송을 막는다.

보관 페이지의 새 첨부가 빠지면 partial로 전환하며 마지막 완전 본문을 보존한다. 복구 archive/충돌/불변 요청의 중첩 첨부 참조는 ZIP과 GC가 같은 수집기를 사용한다. 미전송 Blob/upload bytes 누락은 내보내기를 거부하고, 기기에 없는 서버-only 첨부는 `complete:false`/`missingAssets`와 UI 경고로 알린다. 복구 시 선택한 페이지 계층과 링크 ID를 함께 매핑한다.

확정적 저장 거부는 수정 후 동기화 패널에서 새 UUID로 다시 전송하며 원래 요청을 archive한다. 의존 workflow는 source_review로 재검토한다. 요청 결과가 불확정하거나 payload_mismatch면 UUID를 교체하지 않는다. Page AI는 outbox ACK 뒤 이력을 갱신하고 새 요청 결과를 선택한다.

검증: 전체 332개 tests, 실제 임시 Chrome review regression 8개, 기존 offline/AI/UI gates. 실제 휴대폰 OS·Oracle 배포는 아직 미검증이며 문서 수동 확인표를 따른다. Minor: local commit→queue 사이 약 500ms 전역 sync ready 문구 간격이 남는다.

### 설정 UI와 글자 간격 (2026-10-03)

사이드바 하단 **설정** 아이콘으로 여는 설정은 **화면 / 기기 저장소 / 작업 공간** 세 구역이다. PC에는 왼쪽 탐색 열과 오른쪽 독립 스크롤 본문을, 모바일에는 위쪽 가로 메뉴를 사용한다. 설정창 높이는 일정하고 제목·닫기·탐색은 스크롤 밖에 둔다. 기기 저장소 사용량은 첨부 바이트 기준이며 전체 브라우저 사용량으로 표시하지 않는다. 원래 보관 해제·영구 유지 요청·ZIP 내보내기를 제공하고 새 데이터 저장 계약은 추가하지 않았다. 프롬프트·백업·휴지통은 작업 공간 구역에서 연다. 처음에는 시스템 화면 모드를 따르고 직접 바꾼 모드는 기존 `leneu:theme`에 저장한다.

본문은 기존 16px·자간 normal을 유지하면서 BlockNote 기본 글꼴과 앱 글꼴을 통일하고 행간을 1.7·문단 블록 상하 간격을 5px로 맞췄다. 제목의 음수 자간은 -0.015em으로 줄인다. 공유·오프라인 HTML도 본문 리듬을 맞추며 코드 고정폭·작은 글씨 옵션·목록 말줄임은 유지한다. 확인: `node scripts/qa-settings-typography.mjs`(임시 데이터, 1440/768/390/320px·양쪽 테마·키보드/닫기/관리 화면 이동·저장소 동작).

## 문서 작성 흐름 · 2026-10-03

- 새 작성용 내장 문서 템플릿: 리서치·회의·개발 기록. 여행은 호환 정의로 보존하며 목록/UI에서 제외한다. `shared/documentBlueprints.ts`의 버전·지침·문서 생성기를 UI와 개인 읽기 API가 공유한다. `/api/document-blueprints`는 공개 공유 서버에 등록하지 않는다.
- 홈에서 템플릿으로 새 페이지를 만들거나 빈 페이지에 적용한다. 기존 사용자 저장 템플릿은 별도로 유지한다. 호환용 여행 템플릿은 날짜별 독립 일정표와 예약·교통·예산·준비물·비상 대안을 포함한다.
- 페이지 자료 패널은 메모·페이지·AI 결과를 검색·조회하고 사용자가 지정한 원문 또는 발췌를 본문 끝에 넣는다. 원본 변경·자동 정리·첨부 및 개인 참조 복사는 하지 않는다. 자료 전환 시 이전 요청을 취소한다.
- 삽입은 현재 문서의 편집 잠금·충돌·복구 상태와 공유된 문서 검증기를 확인한 후 기존 로컬 저장 경로를 사용한다. `server/pages.mjs`는 브라우저와 같은 `shared/pageValidation.mjs`를 재노출한다.
- 목차는 실제 스크롤 위치에 맞춰 현재 제목을 표시한다. 모바일 일정 설명은 시간 열 아래 전체 폭을 사용하며 내용은 접지 않는다. 장소가 없는 빈 일정표에는 지도 생성 도구를 표시하지 않는다.
- 에이전트 작성·저장 계약과 앱 사용법: `docs/DOCUMENT_BLUEPRINTS.md`.

## 2026-10-03 검토 회귀 수정

- 준비된 정적 셸의 오프라인 탐색에 `/captures/:id`를 포함한다. `aiJob`·`ocrJob` 쿼리가 있는 상세 재진입과 새로고침도 동일하다. API·공개 공유·다른 origin은 셸로 대체하지 않는다. 본문 보관 여부는 기존 IndexedDB 계약을 따른다.
- 개인 HTTP 서버는 라우트 처리 전에 Host를 검사한다. 기본 허용 호스트는 `localhost`·`127.0.0.1`·`[::1]`이다. `PRIVATE_ALLOWED_ORIGINS`의 정확한 HTTP(S) 출처에 있는 Host도 허용하며, 변경 요청의 Origin은 요청 HTTP 출처 또는 설정된 출처만 허용한다. `cross-site` 변경 요청과 출처 없는 `same-site` 변경 요청은 거절한다. 헤더 없는 로컬 CLI·Vite의 같은 출처 프록시는 보존하고 forwarded 헤더를 신뢰하지 않는다. 실제 개인 HTTPS 주소는 설정 후 개인 프로세스를 재시작해야 한다. 계정 인증·네트워크 노출 설정은 추가하지 않았다.
- 검색의 AI 원본은 `AI 요청 원본`으로 표시하고 완료 결과는 기존 별도 작업 링크를 유지한다. Task 문구는 같은 읽기 savepoint 안에서 현재 `status`·`in_progress`를 조회해 대기/진행/완료를 구분한다. 원본·색인 스키마·순위·커서는 바꾸지 않는다.
- 기본 QA의 첫 저장은 기기 저장 토스트·입력 초기화와 서버에 한 번만 동기화된 원문을 구분해 확인한다.

## 개인 인증 (2026-10-04)

단일 소유자의 비밀번호+TOTP를 구현했다. `server/auth/`의 additive `auth_*` SQLite 자료는 sync/search/public에 노출하지 않는다. `npm run auth:setup`은 로컬 대화형 터미널에서만 등록·코드 확인하며 기존 계정/글을 덮지 않는다. 복구 코드 10개는 최초 터미널 출력 외에는 조회할 수 없다. 비밀번호 변경·Authenticator 변경·복구 코드 재발급 UI는 아직 없다.

production·외부 HOST 및 Compose는 인증 필수가 기본이다. local loopback 개발은 기본 disabled이고, `AUTH_MODE=required`에서 키/계정 누락은 fail-closed503, 인증 없음은401이다. health/authstatus/login과 앱 셸 외의 개인 API는 업로드/첨부/AI/백업/sync를 포함해 보호한다. 기존 Host/Origin 검사와 쓰기의 Origin 필수 검사를 함께 사용한다. HTTPS 운영은 `__Host-` Secure/HttpOnly/SameSiteStrict/host-only 쿠키, 일반 세션12h·기억한 브라우저 절대30d/미사용7d다. 로그인/재인증 때 세션을 교체하고 복원 epoch와 다른 세션을 폐기한다.

`src/auth/`는 첫 로그인,401 안내/재로그인 모달, 설정 보안을 제공한다. 명시 로그아웃은 reload 후에도 잠금 표시를 유지하며 기존 편집기를 unmount하거나 로컬 원문·초안·첨부·동기화 UUID를 지우지 않는다. 서버 연결이 만료된 준비된 기기에서는 로컬 사용을 유지한다. 원격 로그아웃으로 이미 기기에 받은 자료를 삭제/암호화하지 않는다.

`GET /api/auth/status`, `POST /api/auth/login`, `GET /api/auth/devices`, `POST /api/auth/reauth`, `POST /api/auth/logout`, `POST /api/auth/revoke`를 제공한다. 다른/전체 기기 폐기는5분 이내 MFA 필요. 상세 운영·백업 키 보존·Vercel same-origin API proxy 계약은 [AUTHENTICATION.md](docs/AUTHENTICATION.md). 실제 사용자 계정·Oracle/Vercel 배포·휴대폰 Authenticator 등록을 수행한 것으로 취급하지 않는다.

## 서비스 브랜드 (2026-10-04)

서비스 표시 이름은 `anotar`다. 사이드바·로그인·공유/오프라인 HTML·설치 안내·브라우저 제목·PWA 표시 이름에 적용했다. 손글씨 a 심볼을 favicon 64px와 PWA 192/512px PNG로 제공한다. PWA id/start_url과 저장소·쿠키·암호화 식별자 `leneu`는 기존 데이터를 이어 쓰도록 유지한다. 설치된 PWA의 이름/아이콘 갱신 시점은 브라우저에 따라 다르다.

## 메타데이터와 검색 노출

개인 앱에는 한국어 설명·anotar 설치 이름·Open Graph/Twitter 로고 미리보기 메타데이터와 noindex/nofollow를 적용한다. 공유 문서도 noindex를 유지하고 공개 제목과 일반 설명만 미리보기로 사용한다. 배포 origin·절대 이미지 URL·메신저 실검증은 배포 때 확정한다. [메타데이터 운영 안내](docs/SEO.md)를 따른다.

## 2026-10-04 빠른 메모·정리·AI 요청 안내

- 입력함은 **빠른 메모**의 텍스트 입력을 먼저 보여준다. 링크·이미지·파일 선택은 입력 아래의 펼침 항목에서 열고, 메모의 기존 첨부·붙여넣기·저장 단축키는 유지한다. 텍스트 영역은 내용에 따라 늘어나고 긴 초안은 내부 스크롤을 사용한다.
- 단일 메모의 **내 페이지에 정리**에는 선택한 원문/결과 미리보기, 기존 페이지에 추가/새 페이지 생성의 설명, 대상 경로와 포함 내용, 원본 보존 안내를 표시한다. 정리 후 원문과 첨부는 기존 **정리 완료** 목록에서 다시 찾는다. 응답 유실의 같은 요청 재확인과 정리 작업의 UUID·버전 계약을 유지한다.
- AI 입력을 열면 `/api/ai/status`로 실행기 설정 여부·이름·리서치 지원 방식을 표시한다. 연결 상태는 포커스/네트워크 변경과 수동 새로고침으로 다시 확인한다. 이는 실행기 **설정 상태**이며 외부 제공자의 인증·잔액·실제 응답을 검증한 결과는 아니다. 오프라인에서는 기존 기기 보관/온라인 동기화 흐름을 사용한다.
- 전송 범위 안내는 입력 텍스트 글자 수·URL 포함 여부·첨부 제외를 표시한다. URL 본문은 요청 시 수집하므로 이 글자 수에 포함하지 않는다. 지원하지 않는 키워드/URL 리서치는 대체 방법을 안내한다. 연결 실패 안내가 원문 저장을 막지는 않는다.
- 메모의 AI 결과 패널은 **AI 요청과 결과**로 표시하고, 결과가 나오기 전에도 확인된 실행기 이름을 보여준다. 보관한 요청을 처음 실행하는 버튼은 **보관한 요청 실행**으로 표시한다.
- Hive 직접 어댑터는 2026-10-05 추가했다. 서버 전용 환경변수·Chat Completions SSE/JSON·오류 정제·단일 worker를 사용한다. 프런트 번들·공유 문서·브라우저 저장소에 API 키를 넣지 않는다. [설정 가이드](docs/AI_CONFIGURATION.md).
- 페이지 내부 편집기 개선은 후속 작업이다. 이번 변경은 입력함, 정리 화면, 공통 AI 요청 안내 범위다.

## 2026-10-04 모바일 탐색과 작성 진입

- 760px 이하의 입력함 홈은 큰 입력 카드를 숨기고 이어서 작업하기 → 최근 페이지 → 최근 메모 → AI 작업 → 할 일 → 공유 댓글 순서로 보여준다. 빈 메모·AI·할 일 상태의 여백을 줄인다. PC의 입력 카드·상단 검색·새 페이지 버튼은 유지한다.
- PC·모바일의 개인 작업 화면(문서 페이지·설정 관련 화면 포함) 하단 우측에는 44px 원형·반투명 연필 작성 버튼 하나를 표시한다. 공유 읽기 전용 화면에는 작성 기능을 추가하지 않는다. 누르면 native dialog 기반 메뉴에서 **빠른 메모 / 새 페이지**를 선택한다. 모바일은 하단 선택창, PC는 버튼 위 작은 메뉴로 표시한다. 검색은 사이드바 메뉴에 유지한다. `FloatingCreateMenu.tsx`와 `floatingCreate.css`가 진입 버튼·선택창을 관리한다.
- 빠른 메모는 모바일에서 기존 전체 화면 작성창을, PC에서 480px 중앙 모달을 열고 입력칸에 즉시 초점을 준다. 문서·설정 등 현재 주소를 유지하며 저장 성공 시 작성창만 닫는다. Escape·닫기는 초안을 보존하고 작성 버튼으로 키보드 초점을 되돌린다. `CaptureComposerSurface.tsx`는 기존 작성 UI를 native dialog로 옮겨 보여주며 입력·첨부·AI 선택 상태와 저장 로직을 공유한다. 기존 메모 수정·처리 중 이동 보호를 유지한다. 작성창을 닫아도 기존 기기 초안·첨부·AI 선택은 유지한다. 작성 중인 초안이 있으면 버튼에 작은 표시와 이어쓰기 설명을 제공한다.
- 모바일에서 PWA 시작 주소나 공유 수신 주소인 `/capture`로 직접 진입하면 작성창을 바로 연다. 일반 홈·문서 화면의 작성창은 기존 작성 버튼으로 연다. 저장 후 다음 메모는 작성 메뉴에서 다시 시작하며 기존 공유 검토·첨부·초안 보존 계약은 유지한다.
- 일반 문서 페이지에서는 작성 버튼을 유지한다. 브라우저 Fullscreen API가 활성화되거나 검색·사이드 메뉴·전체 화면 작성창·native dialog가 열리면 숨긴다. 모바일에서만 텍스트 입력 초점 중 숨기고, PC에서 입력 중인 경우에는 유지한다. visualViewport 높이 감소만으로는 숨기지 않는다. 실제 iOS 키보드·안전 영역 동작은 실기기 확인이 필요하다.
- 버튼과 선택창 하단은 `safe-area-inset-bottom`을 반영한다. 목록 끝까지 스크롤하면 마지막 내용이 버튼에 가리지 않도록 하단 여백을 확보한다. 선택창은 닫기 버튼·Escape·바깥 탭으로 닫을 수 있고 native dialog의 초점 제한을 사용한다.
- 새 페이지 생성은 기존 작업 명령의 API 경로를 사용한다. 이번 변경에서 새 페이지 생성의 오프라인 동작을 확장하지 않았다. AI 실행기/Hive 연결도 이 변경 범위에 포함하지 않는다.

## 2026-10-04 PC 문서 가운데 배치 복원

댓글 패널이 닫힌 PC 문서는 콘텐츠 영역 가운데에 배치한다. 댓글용 370px 여백은 패널이 열린 경우에만 확보한다. 오른쪽 도구 패널도 남은 영역을 기준으로 문서를 가운데 배치한다. 본문 텍스트의 왼쪽 정렬과 모바일 배치는 유지한다.

## 2026-10-04 검색 입력과 홈 작성 진입 정리

PC·모바일 통합검색 입력칸은 사각 포커스 외곽선을 표시하지 않고 헤더 하단 1px 경계와 커서로 입력 위치를 보여준다. 빠른 메모 링크 입력도 내부 외곽선 대신 필드 경계색을 사용한다. 버튼의 키보드 포커스 표시는 유지한다. 입력함 상단 새 페이지 버튼은 제거하고 전역 작성 메뉴에서 새 페이지를 만든다.

## 2026-10-05 문서 생산성 개선

- **편집:** 블록 손잡이 → 블록 복제 / 블록 유형 변경을 제공한다. 일반 텍스트·제목 1–3·목록·체크리스트·접는 목록·인용을 본문과 자식 블록을 보존하며 변환한다. 복제는 자식 포함 새 블록 ID를 발급하며 기존 실행 취소/다시 실행을 사용한다. 일정과 표의 기존 직접 편집은 유지한다.
- **URL 북마크:** 빈 일반 문단에 HTTP(S) URL 하나만 붙이면 일반 링크/북마크 선택창이 열린다. Escape·바깥 클릭은 URL을 일반 링크로 넣는다. 문장 안/여러 줄/파일 붙여넣기는 기존 편집 동작을 유지한다. 북마크만 선택했을 때 `POST /api/bookmarks/preview`로 제목·설명·대표 이미지를 읽는다. 기존 공개 주소 DNS 고정·리다이렉트·2MB 응답 한도 수집기를 사용하며 내부 주소/자격 증명 URL은 거절한다. 최대 동시 2개, 100개/15분 메모리 캐시, HTML 7초·이미지 4초 제한이다. 대표 이미지는 PNG/JPEG/WebP 32KB 이하 사본만 저장한다. 외부 이미지 핫링크·SVG·스크립트는 넣지 않는다. 로그인/JS 전용 사이트나 큰 이미지는 제목·설명/URL로 남는다. 온라인 정보 새로고침·일반 링크로 변환을 제공한다. 정보 수집은 AI 요청이 아니다.
- `bookmark`는 `{url,title,description,imageData}`만 저장하는 본문 없는 블록이다. 검증·검색·Markdown·수정본 읽기·공유 HTML에 연결한다. 공개 화면은 저장된 문자열/이미지만 렌더하며 제공자에 다시 요청하지 않는다. 이미지 사본은 문서에 포함되므로 해당 문서의 기기 사본에서도 사용할 수 있다. 여러 URL을 한 주소로 합치지 않고 일반 붙여넣기로 넘긴다.
- **페이지 연결 (사용자 피드백 반영):** 페이지 더보기의 **페이지 링크 복사**로 현재 앱의 `/pages/:id` 주소를 복사한다. AI·댓글·보기 query/hash는 포함하지 않는다. 다른 문서의 빈 문단에 같은 앱의 페이지 주소를 붙이면 일반 링크/페이지 링크를 선택한다. 페이지 링크는 기존 `page` 블록에 대상 ID·제목을 저장하며 누르면 해당 문서로 이동한다. 대상 조회는 기존 workspaceFetch의 기기 보관 경로를 사용하고 확인할 수 없으면 URL을 일반 링크로 보존한다. 외부 URL은 일반 링크/북마크 선택을 유지한다. 공개 공유 주소는 개인 페이지 주소로 변환하지 않는다.
- **명령과 하단 영역:** 기존 페이지 추천을 `/`·`@`에 섞지 않는다. `/`는 원래 블록 명령·하위 페이지 만들기, `@`는 일반 문자 입력을 유지한다. 자동 **연결된 페이지** 하단 UI와 역링크 폴링은 제거했다. 기존 저장 링크와 비공개 역링크 파생 색인/API는 보존하며 공개 공유에 노출하지 않는다. 페이지 링크 복사는 공개 공유 발급과 별개의 개인 작업 공간 주소다.
- **메모 정리:** 정리 요청이 기기 전송 대기함에 들어가면 요청 확인/돌아가기 UI를 표시하고 같은 정리를 다른 UUID로 중복 제출하지 않도록 막는다. 원문·버전·영수증 계약은 유지한다.
- **오프라인 안내:** 페이지 기기 보관은 누락된 직접 첨부·앱 실행 파일·마지막 완전 보관 버전을 구분한다. 보관 해제는 서버 원본과 미전송 변경을 지우지 않는다. 동기화 패널은 전송 대기/충돌 수와 마지막 서버 확인 시각을 표시하고 직접 재시도 오류를 안내한다. 페이지 저장 상태는 기기에 저장됨/서버 반영됨으로 구분한다.
- **수정 이력 비교:** 현재와 비교/수정본 전체 보기를 제공한다. stable block ID와 구조를 기준으로 추가·삭제·내용/속성 변경·이동·제목·아이콘 변경을 보여준다. 문장 단위 변경 색칠은 아니며 최대 2,000블록/중첩 8단계 비교와 100개 변경 표시 제한을 안내한다. 복원은 기존 expectedVersion/UUID 검사 후 새 버전으로 저장하며 미저장 변경을 덮지 않는다.
- 좁은 화면의 도구 보조 패널이 열리면 하단 작성 버튼을 숨겨 패널 내용을 가리지 않는다. 태그·가벼운 속성·범용 데이터베이스·CRDT는 이번 작업에 추가하지 않았다.
- 북마크 단독 선택에서는 BlockNote 기본 파일 도구를 표시하지 않는다. 주소 속성을 파일로 오인한 교체·다운로드 버튼 대신 카드의 정보 새로고침·일반 링크 변환과 블록 메뉴를 사용한다. 일반 텍스트 선택의 서식 도구는 유지한다.
- 본문 바깥 클릭으로 블록 선택 작업 줄을 해제한다. 서식 도구·블록 명령 목록·선택 작업·댓글·보조 패널·대화상자·메뉴 조작은 선택을 유지한다.
- **선택과 문서 아래 입력 (후속 수정):** 일반 클릭·커서 이동·입력은 블록 선택으로 세지 않는다. 실제 텍스트 범위 또는 명시적 노드 선택이 있을 때만 선택 작업 줄을 표시한다. 더보기의 선택 블록 이동은 선택이 없으면 현재 블록을 별도 사본으로 잡으며 패널을 닫아도 가짜 선택 상태를 남기지 않는다.
- 마지막 블록 아래의 편집기 빈 공간이나 문서 하단 여백을 클릭/탭하면 마지막 빈 문단을 재사용한다. 빈 문단이 없으면 최상위 끝에 일반 문단 하나를 넣고 커서를 옮긴다. 반복 클릭은 빈 줄을 늘리지 않으며 드래그·터치 취소·댓글/Markdown/복구/변경 잠금/일정 편집 중에는 본문을 추가하지 않는다. 기존 블록 ID·본문·참조와 자동 저장·오프라인 outbox 경로를 유지한다.
- **페이지 링크 재조회 안정화:** `applyRemoteEntity`는 실제 엔티티/기기 보관 상태가 달라질 때만 저장소 변경 알림을 보낸다. 동일·오래된 응답은 재조회 알림을 만들지 않아 페이지 링크 → 읽기 → 알림 → 재조회 순환을 끊는다. readSeq·버전·workspace/epoch 검사, 미전송 원문·첨부 누락 시 마지막 완전 보관본은 유지한다. 첨부가 내려와 보관 완전성만 바뀐 경우에는 알림을 유지한다. 페이지 링크는 같은 대상의 재조회 중 마지막 제목·아이콘을 비우지 않고 확인된 응답으로 갱신한다. 다른 대상 ID로 바뀌면 표시를 초기화하고, 삭제·복원은 기존 누락 표시를 따른다.

### 사이드바 동기화 상태와 글자 크기 · 2026-10-05

사이드바 하단은 프로필 이미지·동기화 상태·설정 버튼을 한 줄로 제공한다. 기존 좌물쇠와 개인 작업 공간 문구 및 그 위의 별도 동기화 행은 제거했다. 동기화 상태 버튼은 같은 기기 저장·outbox·충돌 요약을 사용하며 클릭하면 상세 창을 연다. 긴 상태는 한 줄로 줄이고 전체 문구는 title로 확인할 수 있다. 앱 업데이트 안내는 별도 이벤트가 있을 때만 하단 바로 위에 나타난다.

로고·한국 날짜 헤더는 PC 40px·모바일 44px이며 아래 8px 여백을 없앴다. 상세 창은 공통 --font-ui와 13px·1.6 행간을 사용하고 제목은 14px, 보조 글자는 12px다. 상태 표의 숫자는 고정폭이며 버튼도 본문 글꼴·크기를 따른다. 모바일 상태·설정·동작 버튼은 44px 조작 영역을 유지한다. 변경 범위는 표시와 배치이며 충돌 선택·기기 저장·재전송 계약은 그대로 사용한다. 확인 기록: [.omo/evidence/sync-footer/REPORT.md](.omo/evidence/sync-footer/REPORT.md).


### 공통 메뉴 두 줄 배치 · 2026-10-05

검색·메모·할 일 / AI 작업·공유 댓글의 다섯 항목을 하나의 주 메뉴 안에 3열·2행으로 표시한다. 아이콘과 이름을 함께 유지하며 항목 높이 52px·간격 4px·전체 높이 108px로 PC와 모바일 메뉴에 동일하게 적용한다. 현재 링크는 `aria-current="page"`와 배경으로 구분하고 초점 테두리는 안쪽에 표시해 인접 항목을 침범하지 않는다. 검색 단축키는 기존대로 동작하며 버튼 title과 aria-keyshortcuts로 안내한다.

확인: 임시 DB·비활성 AI 실행기를 사용해 AI 화면 진입·상태 필터·조회 실패 시 목록 유지·재시도 복구, 검색 진입과 1327/900/390/320px 두 테마를 점검했다. [검증 기록](.omo/evidence/ai-nav-fix/verification.json). 실제 로컬 화면의 AI 조회 실패는 API 8787 포트가 내려간 상태에서 재현됐고 개발 서버를 다시 구동한 뒤 정상 목록을 확인했다.

## 기술 아키텍처 문서와 콜아웃 (2026-10-05)

- 설정의 **서비스 정보 → 기술 아키텍처**는 `/architecture.html`을 새 탭으로 엽니다. `docs/architecture-overview.html` 한 원본을 Vite 개발 미들웨어와 빌드 자산으로 제공하며 Docker 빌드·오프라인 셸 manifest에도 포함합니다. 공개 읽기 서버에는 이 경로를 추가하지 않습니다.
- HTML은 외부 라이브러리 없이 실행되고 현재/배포 제안/오프라인 구조도, 화면·서버 진입점, 검색 가능한 파일 역할, 저장·API·운영·디버깅 경로를 설명합니다. 운영 기록과 미배포 제안을 구분하고 비밀값·개인 자료를 넣지 않습니다.
- `callout`은 schemaVersion 1의 inline 본문과 children을 사용하는 추가 블록입니다. `src/pages/CalloutBlock.tsx`에서 `/콜아웃`·`/callout`으로 만들고 아이콘 5종·투명 또는 배경색 9종·border boolean을 선택합니다. 원본 블록 ID와 기존 자동 저장·수정 이력·동기화 계약을 그대로 사용합니다.
- `shared/callout.ts`·`shared/pageValidation.mjs`가 유한한 색·아이콘·정렬·테두리 속성을 검증합니다. 임의 CSS/SVG/HTML 속성은 받지 않습니다.
- `public/callout.css`는 편집기·공유·오프라인 사본의 밝기별 박스 스타일입니다. 공개 자산 허용 목록과 ZIP 자산 목록에 함께 추가합니다. children은 박스 안에 출력하고 개인 페이지 링크 하위 내용은 기존 공개 제외 규칙을 유지합니다.
- Markdown·AI 변환은 콜아웃을 인용문 텍스트로 내보냅니다. Markdown 붙여넣기로 박스 모양이 복원된다는 보장은 없습니다.
- 확인: `test/callout.test.mjs`·`test/pwa-shell.test.mjs`, `scripts/qa-architecture-callout.mjs`와 [검증 기록](.omo/evidence/architecture-callout/REPORT.md). 임시 Chrome의 모바일 화면 확인은 실제 휴대폰 설치·키보드·강제 종료 검증과 구분합니다.


## 할 일 페이지 참조·AI 읽기 화면·일지 디자인 샘플 (2026-10-05)

### 할 일의 선택적인 참조 페이지

`Task.pageId`는 UUID 또는 null인 선택 필드다. 기존 SQLite에 nullable `page_id`만 추가하며 예전 행·버전·생성 시각을 재작성하지 않는다. 생성·수정 API와 동기화 payload가 참조를 전달하고, 기존 요청에서 빠진 필드는 기존 연결을 보존한다. 참조가 없는 생성의 재전송 지문은 예전 형식을 유지한다.

할 일의 제목을 눌러 편집하면 참조 페이지 선택란이 나타난다. 목록·보드·홈 요약에서 페이지 이름을 눌러 해당 페이지로 이동하며 상태 변경은 연결을 보존한다. 연결 해제는 할 일이나 페이지를 삭제하지 않는다. 참조는 외래 키 없이 독립 보관하므로 대상 페이지가 목록에 없더라도 기존 ID를 유지한다. 페이지 목록은 기존 기기 저장 메타데이터를 사용하며 오류 때 이전 목록·선택을 유지하고 재시도한다.

### 개인 AI 요청·결과

`AiRequestSummary.tsx`는 선택한 작업의 불변 요청 사본에서 당시 템플릿 이름·버전·유형·추가 지시를 보여준다. 메모와 Page AI에서 같은 컴포넌트를 사용한다. 사용 중인 현재 템플릿으로 과거 실행을 재해석하지 않는다.

`AiResultContent.tsx`·`markdownReading.ts`는 기본 읽기 / Markdown 원문을 전환한다. 직접 의존성 `marked@16.4.2`로 토큰을 만들고 허용 React 요소만 렌더링한다. provider HTML은 텍스트로 표시하고 외부 이미지는 가져오지 않으며 HTTP(S) 이외 링크는 클릭 가능한 요소를 만들지 않는다. Markdown 복사·페이지로 정리·기존 결과 반영 계약은 유지한다. 이 표시 변경은 공개 공유에 개인 요청문을 추가하지 않는다.

PC의 AI 메모 상세는 결과 열을 넓히고 큰 아이콘과 반복 실행 정보·상단 빈 공간을 줄였다. 공통 메뉴에서는 별도 입력함 항목을 제거했으며 로고가 홈 진입을 담당한다.

### 일지 디자인 미리보기만 제공

[docs/design/journal-preview.html](docs/design/journal-preview.html)은 `http://127.0.0.1:5173/docs/design/journal-preview.html`에서 볼 수 있는 독립 샘플이다. 하루 여러 짧은 기록을 한 달 전체의 연속 흐름으로 보여준다. 위로 이동하면 이전 달 예시를 읽던 위치에 이어 붙이고, 아래 작성란에서 새 기록을 오늘의 끝에 추가한다. 달력은 날짜 위치로만 이동하며 작성 날짜·초안을 바꾸지 않는다. 과거 기록 수정·취소도 새 기록 초안을 보존한다. 밝은·어두운 화면을 확인할 수 있다. 전용 `anotar:journal-design:v1` 저장소만 사용하고 제품 API·DB·실제 기록에 접근하지 않는다. 실제 일지 경로·서버 저장·오프라인 동기화·수정 이력은 아직 구현하지 않았다. 설계 방향은 [일지 UI 설명](docs/design/journal-design.md)을 참고한다.

검증: 전체 테스트 395/395, 빌드, 오프라인 참조 저장·재연결 반영과 [임시 저장소 브라우저 확인](.omo/evidence/task-ai-journal/verification.json). 상세 범위는 [검증 기록](.omo/evidence/task-ai-journal/REPORT.md)을 따른다. 모바일 Chrome 크기 변경 검증은 실제 휴대폰의 설치·키보드 검증과 구분한다.


### 일지 미리보기의 월별 연속 읽기 (2026-10-05)

사용자 피드백에 따라 날짜 한 개를 선택해 내용이 바뀌는 화면을 월 전체 기록의 연속 스크롤로 변경했다. `docs/design/journal-preview.html`만 사용하는 별도 미리보기이며 제품 라우트·DB·동기화는 추가하지 않았다. 기록 영역과 하단 작성란을 분리하고, 이전 달 prepend 시 스크롤 위치·최근 기록 append 시 맨 아래 따라가기·폰트/화면 크기 변경 때 최근 위치를 유지한다. 기존 샘플 저장 키는 유지한다. 날짜별 작성 초안을 전환하는 방식은 제거했고 탐색과 무관한 오늘 작성 초안 하나를 유지한다. 확인: [브라우저 기록](.omo/evidence/journal-stream/verification.json), [검증 범위](.omo/evidence/journal-stream/REPORT.md).


### 타임박싱 일지 예시 (2026-10-05)

[독립 타임박싱 미리보기](docs/design/timeboxing-preview.html)는 사용자 PDF의 핵심 할 일 3개·생각·아이디어·회고·10분 눈금에 계획/실제 기록 두 열을 추가한 가상 예시다. 기존 연속 일지 미리보기는 그대로 유지한다. 일간 기본은 00–24시의 빈 시간까지 표시하는 하루 표다. 같은 시간 행에서 계획/실제를 비교하고 시간 범위와 이어짐을 표시한다. 목록은 보조 보기이며 입력은 시간·내용이다. 입력창은 내용·시작·종료 세 칸이고 목록에는 반복 소요시간·유형·짧은 메모를 표시하지 않는다. 기존 v1 항목의 유형/메모는 편집 저장 시 보존한다. 종류별 색칠 없이 한 시간 경계선만 사용한다. 분 눈금과 점유 이중선은 제거했다. 새 항목은 시작 +30분으로 종료를 자동 조정하며 직접 수정한 종료는 유지한다. 달력의 작성일 표시·월요일 기준 주간 비교·이달만 포함하는 주별 월간 합계·직접 작성한 회고 모음을 제공한다. 날짜별 작성·항목 추가/수정/삭제는 기존 전용 `anotar:timeboxing-design:v1` 브라우저 저장소를 사용한다. 제품 일지 메뉴·서버 저장·수정 이력·PWA 동기화는 아직 없다. 화면 규칙과 후속 연결 제안은 [설명](docs/design/timeboxing-design.md), 이번 확인 범위는 [검증 기록](.omo/evidence/timeboxing-clean-sheet/REPORT.md)을 따른다.

### 타임박싱 10분 눈금 변경 (2026-10-05)

일간 표는 상단 10분 눈금에 맞춰 제목의 위치/너비로 시간을 표현한다. 반복 시간 텍스트 대신 수정창/hover로 전체 범위를 확인한다. 계획/실제 경계를 강화하고 용지 최대 폭1280px로 줄였다. 모바일 표만 최소640px 가로 스크롤하며 목록 보기를 유지한다. 독립 예시이며 제품 통합은 아니다. 검증: `.omo/evidence/timeboxing-ten-minute/verification.json`.

### 타임박싱 계획 중심 변경 (2026-10-05)

최신 독립 미리보기는 실제 기록 열을 제거한 계획 한 열이다. 상단 달력은 타임박싱 작성일만 표시하고 날짜 제목은 연도/월/일/요일 전체를 표시한다. 시간 라벨은 중앙 정렬이다. 일정 hover/focus의 상세 보기·× 미이행, 상세창의 미이행 체크, 전체 날짜의 미이행 항목을 모은 되짚어보기를 제공한다. 미이행은 다시 해제 가능하며 삭제와 구분된다. `plan[].missed` optional boolean으로 기존 전용 localStorage에 저장한다. 기존 actual 데이터는 보존하되 UI·요약에서 제외한다. 앞선 두 열/실제 기록 비교 설명은 최신 화면에 적용하지 않는다. [현재 화면 규칙](docs/design/timeboxing-design.md), [검증](.omo/evidence/timeboxing-plan-only/REPORT.md).

타임박싱 후속 정돈: 일정 액션은 같은 행 오른쪽 끝에 표시하고 미이행은 테마별 붉은색으로 구분한다. 핵심 할 일은 제목/행 클릭 체크·별도 수정, 달력 오늘 밑줄 제거, 가상 업무 안내 문구 제거를 적용했다. 검증 `.omo/evidence/timeboxing-inline-actions/verification.json`.

### 일지 메뉴 연결 (2026-10-05)

개인 앱 `/journal`은 검색·메모 다음3번째, 할 일은4번째다. `src/journal/JournalWorkspace.tsx`와 `controller.mjs`가 기존 타임박싱 HTML/CSS를 공유하고 Shadow DOM으로 앱 스타일 간섭을 막는다. 지연 로딩·앱 테마 상속·리스너 정리를 적용했다. 한국시간 오늘의 빈 상태로 시작하고 `anotar:journal:v1` 브라우저 저장소에 저장한다. 예시 저장소/자료는 가져오지 않는다. 일정 hover 액션은 테두리 없는 작은 상세/×이고 미이행 제목 앞 ×는 제거했다.

**일지는 현재 기기 로컬 저장만 지원한다.** 기존 서버 동기화·백업·수정 이력·복구 내보내기에 포함되지 않는다. 상단/하단에 이를 표시한다. 서버 API 쓰기는 추가하지 않았다. 다른 탭의 저장 변경은 덮어쓰지 않고 오류로 남긴다. 검증은 `.omo/evidence/journal-integration/verification.json`; 타입검사와 production build 통과.

일지 후속 정돈: 할 일0–20개(빈3개 기본)·최근 삭제 되돌리기, 동일 크기 투명 테두리 액션·인접 일정 경계, 팝업 여백/미이행 스위치를 적용했다. 앱 스코프 변환이 `.dialog-body`를 훼손하던 문제를 수정했다. 하단 안내/중복 추가 버튼은 제거하고 저장 상태는 상단이다. 메모는 아이디어/회고/Brain Dump 순서로 PC 높이를 시간표에 맞추고 모바일 달력은 본문 전체 폭이다. 검증 `.omo/evidence/journal-polish/verification.json`.

일지 메모 비율 조정: 회고/아이디어/Brain Dump 순서, PC 약1:1.4:2.6으로 시간표 하단에 맞춘다. 모바일은 자연 높이. 빈 할 일은 `할 일 입력…` 안내와 비활성 체크로 표시하며 실제 저장값은 빈 문자열이다. 편집 테두리 대신 행 배경으로 포커스를 표시한다. 검증 `.omo/evidence/journal-notes-balance/verification.json`.

일지 PC 드래그: 가운데 이동·처음/끝 조각 가장자리 resize,10분 단위·최소10분·당일 범위, 겹침 거절·Escape/스크롤/resize 취소. 터치는 상세창 시간 입력 유지. 상세 버튼 없이 붉은 ×만 오른쪽 안쪽에 표시한다. 모눈·일정 전체 테두리·분 눈금 띠·할 일 고정열을 적용했다. `.omo/evidence/journal-drag/verification.json`과 순수 함수 테스트3건 통과. 저장은 여전히 기기 로컬이다.

## 일지 서버 동기화·정적 사이트 호스팅 (2026-10-05)

이 절은 앞의 **일지 기기 로컬 저장만** 설명을 대체한다. `/journal`은 날짜별 typed journal 엔티티를 SQLite와 기존 IndexedDB/outbox/sync protocol에 저장한다. 날짜별 버전 충돌은 양쪽/기준 사본을 보존하며 명시적으로 해결한다. workspace/date deterministic UUID 및 서버 unique 제약을 사용한다. 기존 기기도 journal bootstrap을 한 번 수행한다. localStorage 원문·숨긴 actual 자료·이관 당시 원문 JSON을 보존하고 날짜 충돌은 확인을 요구한다. 이전 브라우저 일지의 소유 작업 공간은 기기 전체에 한 번 기록하므로 다른 작업 공간으로 전환해도 같은 원문을 자동으로 다시 가져오지 않는다. 서버 미반영 기기 기록과 이전 일지가 겹치면 현재 entity/outbox를 유지하고 별도 이관 확인에서 현재 기기 내용 또는 이전 일지를 선택한다. 입력 중 서버 내용이 바뀌어도 사용자가 보던 버전을 기준으로 전송해 충돌을 감지한다. SQLite 자동 백업에는 일지 테이블이 포함되며 복구 ZIP은 일지 JSON/참조/이관 사본을 보존한다.

24시간 표시를 유지한다. 비어 있지 않은 오늘 할 일을 시간표로 드래그하면 별도 계획 ID와 할 일 ID/날짜/당시 제목을 저장한다. 같은 할 일을 여러 계획으로 배정할 수 있으며 계획 삭제/미이행은 원래 할 일 체크를 변경하지 않는다. 주간은 주요 할 일·계획 시간·미이행·회고, 월간은 날짜별 회고를 이어 읽는다. 미이행 계획의 다시 계획하기는 원래 기록을 남기고 새 날짜에 새 계획을 생성한다. 독립 프리뷰는 API와 분리된 기존 샘플 저장소를 유지한다. 검증 `.omo/evidence/journal-sync/verification.json`, `repository.json`과 `test/journal-sync.test.mjs`.

`/hosting` 및 인증된 `/api/hosting`은 정적 폴더 등록·목록·이름 수정·공개/중지를 제공한다. `server/hosting/store.mjs`는 별도 HOSTED_SITES_DIR registry/불변 bundle을 저장하며 개인 SQLite에 사이트 콘텐츠를 넣지 않는다. `server/sites.mjs`8792는 이 디렉터리만 GET/HEAD로 제공하며 개인 DB/API/키를 마운트하지 않는다. MIME/ETag/파일 allowlist/encoded 경로 검사/전 구간 symlink 거부, multipart 총량/파일 제한·중단 정리를 적용했다. 사이트당1,000파일·50MiB/개별25MiB, 전체100사이트·500MiB. 새 등록은 중지 상태. 주소를 비우면 이름의 영문 부분(없으면 site)과 고유값으로 경로를 생성한다. 같은 이름의 반복 등록은 다른 주소를 받고 이름 수정으로 주소는 바뀌지 않는다. 명시한 같은 slug 등록은409로 기존 파일을 보존한다. 이미 다운받은 파일은 중지로 회수할 수 없다. 파일 갱신/삭제 UI는 후속이다.

설정 작업 공간에서 목록에 진입한다. 독립 웹사이트는 다른 origin의 새 탭에서 열며 개인 앱 DOM에 HTML을 주입하지 않는다. 기본 로컬 origin은127.0.0.1:8792, 운영 제안은 host.leneu.store다. 수학 샘플은47HTML+3CSS/JS, PDF·개발 파일 제외 사본이다. 해당 원본의 외부KaTeX CDN 연결은 유지된다. 정적 콘텐츠는 SQLite 자동 백업 범위 밖이며 별도 디렉터리 백업을 사용한다. [호스팅 안내](docs/STATIC_HOSTING.md), `.omo/evidence/static-hosting/verification.json`과 hosting 테스트를 참고한다. DNS/TLS/Oracle 배포·실제 휴대폰은 이번 로컬 검증과 구분한다.


## 여행 기능 분리 (2026-10-05)

사용자 승인으로 새 작성 `/` 메뉴의 지도·일정과 기본 여행 문서 템플릿을 제외했다. `documentBlueprints`는 리서치·회의·개발 기록만 제공하며 여행 상세 API/생성 함수는 `legacyDocumentBlueprints`를 통한 호환용이다. 기존 블록 스키마·문서·이미지·공유·Markdown·오프라인 내보내기와 사용자 저장 템플릿/AI 프롬프트는 보존한다. 여행 기능을 메뉴에 다시 추가하지 않으며 신규 개발은 별도 서비스로 진행한다. 기존 여행 문서 변환과 호환 코드 삭제는 이번 작업에 포함하지 않는다. [재활용 묶음·의존성·AI 후속 인계](docs/handoffs/2026-10-05-travel-service-extraction.md)를 먼저 확인한다. 위의 이전 지도·여행 문서 규격은 기존 문서 호환을 설명한다.


### AI 요청 화면 개선 (2026-10-05)

- 설정 AI 패널에서 Hive/Devin 기본·모델 변경. 키/CLI/인증은 서버 설치 항목이고 UI에서 임의 실행 경로를 입력하지 않는다.
- 메모·페이지 요청에 실행기·모델 선택; draft/workflow/영수증에 사본 보존. 추가 지시·프롬프트 미리보기는 접을 수 있다.
- `/ai` 행은 사용한 템플릿 버전·실행기·모델을 보여준다. 정확한 메모 작업 링크는 목록을 숨기고 결과를 먼저 넓게 읽는다. 원문/재요청/당시 입력은 접히며 원문 편집·결과 채택은 유지한다.
- Hive는 출력 최대 256KiB, 최대 완료 토큰 4096, SSE 완료표시·중단·형식/도구 응답 검사. 인증/요청 제한 오류는 구분하고 자동 provider fallback·자동 유료 재시도는 없다.
- 변경하지 않은 기본 여행 AI 프롬프트만 보관 처리하며 수정본과 기존 요청 사본은 유지한다. 사용자 편집/복제 템플릿은 유지한다.
- OpenCode CLI는 아래 모델 관리 확장에 구현했다. 자동 Hive 전환은 구현하지 않았다.

### OpenCode 모델 관리 (2026-10-05)

설정 → AI에 OpenCode CLI를 추가했다. 공식 Zen 86개 사본 중 사용자 요청에 따라 무료 텍스트 모델 11개만 초기 등록하며 공식 목록 갱신도 확인된 무료 지원 모델로 제한한다. 모델 ID·표시 이름·가격 안내·사용 여부·기본 모델을 개인 DB에 저장하고 요청별로 사용 중 모델을 선택한다. 갱신은 초안 미리보기이며 기존 수정과 과거 요청을 보존한다. 직접 등록한 다른 제공자는 인증·CLI 지원이 별도로 필요하다. `GET /api/ai/models/opencode`는 개인 인증 경로이며 고정 공식 URL만 읽는다.

실행은 `AI_OPENCODE_ENABLED=false`가 기본이고 기존 전체 disabled 스위치가 우선한다. 설치된 CLI의 stdin·도구 제한·임시 XDG 저장소·제공자별 인증 복사·JSON 완료 검증을 구현했다. 자동 Hive 전환은 없다. Oracle ARM64의 OpenCode 1.18.34·`opencode/big-pickle` 응답과 파일·셸 권한 거절을 확인했다. 요약 단계의 전역/agent 권한은 `ask`이며 비대화형 CLI의 자동 거절을 사용하고 자동 승인 옵션은 전달하지 않는다. 검색 단계에만 `websearch: allow`를 추가한다. 검증된 CLI 버전만 요청 전에 허용한다. 전체 무료 모델 응답을 확인한 것은 아니다. 무료 표시를 비용 강제 제한으로 해석하지 않는다. 자세한 절차와 약관 구분은 [AI 설정 문서](docs/AI_CONFIGURATION.md)를 따른다.

### 서비스 Telegram 알림 (2026-10-05)

개인 `server/serviceNotifications.mjs`가 AI worker 실행 시작/확정 실패를 제한된 순차 메모리 큐로 전송한다. 모델·템플릿은 저장된 요청 사본이며 본문 앞 80글자는 명시 환경 설정으로만 켠다. 기본 비활성, 공개 share/host 환경에 키 전달 없음, 완료/대기열 접수/서버 재시작 중단 작업의 알림 없음, 자동 재시도/전달 보장 없음. [변수·비밀 파일 읽기·제한](docs/SERVICE_NOTIFICATIONS.md). 실제 운영 배포·활성화와 테스트 메시지 수신을 구분한다.

### AI 요청 제출 전 확인 (2026-10-06)

온라인 메모 입력창은 선택한 실행기/모델의 연결·지원 여부를 확인해 제출 버튼과 저장 핸들러 모두에서 AI 요청을 차단한다. OpenCode는 키워드/URL 리서치와 직접 요청을 지원하고 Hive는 URL 리서치와 직접 요청을 지원한다. 미지원 상태의 **메모만 저장**은 현재 글·첨부를 AI 선택 없이 보관하고 작업을 만들지 않는다. 오프라인 요청 보관·나중 동기화는 유지한다. 기존 실패 작업의 사본·이력·모델과 자동 fallback 없음은 유지한다.

### OpenCode 키워드 검색 연결 (2026-10-06)

OpenCode discovery → 기존 공개 본문 수집 → 같은 모델의 도구 없는 요약 경로를 연결했다. 저장된 템플릿·추가 검색 조건·요청 사본·명시 재시도는 유지한다. `opencodeSearch.mjs`는 검증된 1.18.34 Exa websearch의 실제 Title/URL과 정상 종료를 검사하며 생성된 최종 텍스트의 링크는 무시한다. 검색 단계에만 전역/agent `websearch: allow`를 추가하고 나머지는 비대화형 자동 거절을 유지한다. 후보 5개·최종 본문 3개·공유 120초, 요청별 XDG 정리·원본 보존·자동 유료 fallback 없음은 유지한다. 검색 1회·240자·fast/context 10,000자는 호출 후 검사이며 제공자 과금 강제 상한이 아니다. 실제 adapter capability를 API/요청 화면에 반영한다. Oracle ARM64의 무료 Muse Spark로 합성 주제의 검색·수집·요약·임시 DB 결과 저장과 확인한 출처 3개·원본 보존·남은 임시 기록 0개를 확인했다. 모든 무료 모델을 검증한 것은 아니다.
