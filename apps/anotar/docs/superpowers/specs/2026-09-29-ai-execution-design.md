# AI 실행 백엔드: 첫 연결 단계

상위 계약: [AI 요청 하네스](2026-09-28-ai-request-harness-design.md). 기존 프롬프트 관리·Capture·페이지 연결을 유지하고, 저장한 AI 요청의 실행 상태와 결과를 서버에서 관리한다. 사용자는 백엔드 개발과 Devin 등으로의 테스트를 요청했다. 설치·인증·공식 CLI 계약을 확인해 짧은 합성 샘플로 실호출을 검증한다. 앱은 실행기를 자동 선택하거나 다른 제공자로 대체하지 않는다.

## 저장과 작업

- Capture 저장 응답은 AI 완료를 기다리지 않는다. AI 설정이 있으면 같은 SQLite 트랜잭션에서 작업을 등록한다. 과거 `prepared` 자료는 자동 실행하지 않는다.
- Capture 제출 UUID는 파일 순서·이름·MIME·크기·SHA256·본문·URL·AI 선택으로 지문을 만든다. 같은 UUID와 같은 입력은 기존 항목을 반환하며 새 업로드 바이트를 제거한다. 다른 입력은 409. 응답을 잃고 새로고침해도 localStorage의 제출 UUID·선택한 템플릿 스냅샷과 복구한 순서별 파일 바이트의 지문이 유지된다.
- 잘못된 AI 설정은 기존과 같이 전체 저장을 400으로 거절한다. 실행기 미설정·호출 실패는 저장 성공과 별도로 작업 실패로 표시한다.
- 작업은 원본 ID·버전·입력·프롬프트 스냅샷을 보존한다. 수정은 실행을 유발하지 않는다. 명시적 재요청은 현재 메모와 보관한 템플릿으로 새 스냅샷을 만들며, 이전 요청 기준 재시도도 별도로 보존한다. UUID 재사용은 작업을 중복하지 않는다.
- `queued → running → result_ready | failed`, 동시 실행 1, 120초 제한, 응답 최대 256KiB. 실행 토큰이 일치할 때만 완료한다. 재시작 시 미완료 running은 interrupted 실패로 정리하고 자동 재과금하지 않는다.
- 휴지통 원본의 작업은 조회하지 못한다. 실행 전 삭제된 작업은 취소 실패로 정리하고 전송하지 않는다. 실행 도중 삭제되면 작업은 종료하되 UI에서는 숨겨지고 복원 후 이력으로 확인한다.

## 실행기와 자료

- 서버 설정의 HTTP JSON 실행기 계약을 제공한다. `AI_RUNNER_KIND=http`, `AI_RUNNER_URL`·선택적 `AI_RUNNER_TOKEN`은 서버에만 둔다. 실행기는 자료와 요청을 받아 Markdown 응답을 반환하며 도구 실행은 이 앱에서 제공하지 않는다. URL만 설정한 기존 gateway 계약도 지원한다. 이 앱의 JSON envelope를 번역하는 게이트웨이이며 OpenAI/Anthropic의 직접 API wire 형식은 아니다. HTTP abort는 제한 시간 내 중단하지만 제공자 작업·과금 취소를 보장하지 않는다.
- 검증한 설치형 실행기 `AI_RUNNER_KIND=devin`은 `AI_DEVIN_BIN`(기본 devin)과 `AI_DEVIN_MODEL`(기본 swe-2-high)을 명시적으로 선택한다. 사용자의 CLI 인증 저장소를 이용하고 앱/API 키는 프로세스 환경에 전달하지 않는다. 작업별 0600 프롬프트·설정만 있는 임시 디렉터리, 고정 spawn 인자, read/edit/grep/glob/exec/fetch/MCP deny 설정, 합계 256KiB stdout/stderr 상한을 사용한다. Mac/Linux에서는 소유 POSIX 프로세스 그룹에 SIGTERM을 보내고 200ms 뒤 SIGKILL로 강제 종료한다. 실제 child close·임시 공간 정리·runner.drain(signal)을 기다린 뒤 실패 기록·다음 작업·서버 종료를 진행한다. Windows는 직접 자식만 종료하며 소유 그룹을 벗어난 프로세스까지 보장하지 않는다. 이는 OS 샌드박스가 아니고 설치된 CLI 인증 저장소·외부 제공자는 유지된다. CLI 사용량은 보고받지 않으므로 null. 모델은 서버 설정으로 교체한다. CLI는 이 앱에서 자동 설치/로그인하지 않으며 Docker 기본 이미지에도 포함하지 않는다.
- 미설정 상태에서는 `runner_unavailable`로 정직하게 표시한다. 개발·QA는 임시 HTTP fixture를 사용하고 결과에 `test` 실행기 표시를 남긴다. 실제 서비스에 가짜 결과 모드는 넣지 않는다.
- 자유 요청은 텍스트·URL 문자열을 전달한다. URL 리서치는 서버가 공개 HTTP/HTTPS 주소를 먼저 수집한다. URL credentials, 로컬·사설·예약 IPv4/IPv6, DNS의 차단 주소, 각 redirect를 검사하고 연결 주소를 고정한다. 10초·redirect 3회·2MiB·텍스트 50,000자 제한. 실제 수집한 URL·시각만 출처로 표시한다. 수집 실패는 AI에 만들어내도록 요청하지 않는다.
- 첨부 바이트는 자동 전송하지 않는다. 첨부만 있는 요청은 unsupported_input 실패, 첨부와 글이 함께 있으면 글만 처리한다는 표시를 한다.
- 결과 계약은 `{ markdown, sources?, usage? }`. 출처는 수집된 자료와 대조한다. 자유 요청의 링크는 검증된 출처라고 부르지 않는다. usage 미제공은 null. 결과는 HTML로 삽입하지 않고 텍스트로 안전하게 확인·복사한다. 결과 Markdown의 페이지 채택과 이미지 OCR은 후속 단계다.
- 공급자 오류 본문·키·프롬프트·원문은 서버 로그나 사용자 오류 메시지로 흘리지 않는다. HTTP 실행기는 외부 URL로의 redirect를 따르지 않는다.

## 화면과 API

- 작성란 체크·템플릿 선택을 유지하고 저장 후 실행됨을 안내한다. 목록의 높이·NEW 위치를 유지한 작은 상태 표시와 상세의 결과 영역을 추가한다.
- 상세에서 대기·실행·완료·실패, 기준 버전·이전 내용 기준, Markdown 복사·재요청·이전 이력 확인. 요청문은 접어서 유지한다. 실행기 미설정은 연결 필요로 읽힌다.
- 상세가 보이는 동안 진행 중 작업만 2초 폴링, 문서 hidden이면 멈춤, 완료·실패 때 멈춤. AI 모듈은 lazy load하여 기본 메모 입력 비용을 늘리지 않는다.
- `GET /api/ai/status`, `GET|POST /api/captures/:id/ai-jobs`, `GET /api/ai-jobs/:id`, 가시 목록 최대 20개 요약 `GET /api/ai-jobs?ids=`. POST에 requestId·expectedVersion·선택적 retryOf, 이전 AI 메모만 실행 가능. 응답 유실 재시도는 버전 검증보다 기존 UUID 조회가 우선한다.
- 실데이터·기존 사용자 파일은 테스트에 쓰지 않는다. 임시 DB·서버·업로드로 수명 주기와 UI를 검증한다. 현재 loopback 개발 서버의 인증/공유 경계를 확대하지 않는다.

## 성공 기준

저장 즉시 반환, 중복 저장/작업 없음, 하나씩 실행, 재시작 후 queued 보존/running 실패, 실패와 늦은 응답에서 원본 보존, URL 내부 접근 차단, 임시 fixture 결과 확인·복사와 320/390/desktop 밝음·어두움 사용 가능. 기존 전체 테스트·빌드·핵심 UI 회귀 통과. 실제 Devin/API 호출 여부는 별도로 명시한다. 일반 테스트·QA 자식 서버는 실행기를 강제로 비활성화하며 `scripts/ai-devin-smoke.mjs`만 명시적으로 실제 CLI를 호출한다.

## 2026-09-29 구현 확인

현재 설정·API·SQLite·상태/결과·한도와 후속 범위는 [현재 구현 규격](../../../CURRENT_IMPLEMENTATION.md#ai-요청-실행), 실행기 설정과 실호출 구분은 [README](../../../README.md#ai-실행기-설정)을 따른다. 일반 fixture 테스트 107/107·빌드·핵심/AI UI QA가 통과했으며 native 프로세스 종료 문제는 SIGTERM에 저항하는 fixture의 RED→GREEN으로 수정했다. [문서 검증 기록](../../../.omo/evidence/ai-documentation.md)에 확인한 증거와 범위를 남긴다.
