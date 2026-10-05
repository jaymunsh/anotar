# AI 실행기·모델 설정과 요청 운영

2026-10-05 로컬 구현: Hive, Devin CLI, OpenCode CLI와 사이트 내 모델 목록 관리. Oracle 설치·배포·ARM64 실행 검증은 아직 하지 않았다.

## 서버 환경

```dotenv
AI_RUNNER_KIND=hive
HIVE_API_KEY=
HIVE_BASE_URL=https://api-cdn.thehive.ai/api/v3
HIVE_MODEL=
AI_DEVIN_BIN=devin
AI_DEVIN_MODEL=swe-2-high
AI_DEVIN_CREDENTIALS_FILE=
```

키와 Hive 계정에서 활성화한 모델 ID를 실제 `.env`에 넣는다. 파일 권한은 0600, Git·이미지·클라이언트 번들에는 포함하지 않는다. `.env.example`과 Compose의 `AI_RUNNER_KIND`는 기본 `disabled`; AI 실행을 허용하려면 `hive`로 바꾸고 사용할 프로필의 인증·CLI를 준비한다. OpenCode는 추가로 `AI_OPENCODE_ENABLED=true`가 필요하다. 환경 변경 후 서버 프로세스를 재시작한다. UI 저장 전 환경 모델값은 기본값이며, 저장 후에는 SQLite `ai_settings`가 우선한다. UI에서 모델만 바꾸면 재시작은 필요 없다.

**설정 → AI**는 기본 실행기와 모델 ID를 저장한다. OpenCode는 모델 목록을 사이트에서 추가·수정·삭제·사용 여부 변경하고 요청별로 선택할 수 있다. `설정됨`은 키/CLI의 구성 여부이며 실제 외부 인증·모델 사용 가능 확인이 아니다. 키, 인증 파일 경로, 임의 executable/endpoint를 브라우저에 전달하지 않는다. 다른 기기에서 설정이 바뀌면 최신 설정을 불러온 뒤 저장한다.

## 요청과 결과

1. 메모 또는 페이지에서 템플릿을 고른다. 추가 지시는 선택 항목이다.
2. 요청 옆 `실행기 · 모델`에서 Hive/Devin/OpenCode를 선택한다. OpenCode는 사용 중으로 등록한 여러 모델 중에서 고른다.
3. 제출 시 실행기·모델·입력·템플릿/버전·프롬프트를 사본으로 저장한다. UUID는 응답 유실·새로고침에도 유지한다.
4. worker는 한 번에 하나씩 실행한다. 설정 변경은 대기 중인 작업을 변경하지 않는다.
5. `/ai`에서 상태와 사용한 모델·템플릿을 확인한다. 메모 결과 링크는 결과를 먼저 보여주고 현재 원문·당시 입력·재요청 설정은 접는다.
6. 실패한 요청 그대로 재시도는 당시 모델도 유지한다. 새 모델로 요청하려면 실행기를 다시 고르고 현재 메모로 새 요청한다.

Hive와 OpenCode는 직접 요청과 URL 본문 조사를 지원한다. URL 없는 키워드 검색은 Devin이 필요하다. 요청에는 텍스트와 수집한 자료만 전달하며 첨부 바이트는 전송하지 않는다. 결과를 원문에 자동 적용하지 않는다.

## 한도·오류

- 단일 worker, 작업 전체 120초, 출력 256KiB, Hive 최대 완료 토큰 4096.
- SSE 완료 표시 없이 연결이 끊기면 완료 결과로 저장하지 않는다. 도구 호출·잘못된 응답·길이 제한으로 잘린 응답은 거절한다.
- 인증 오류·사용량 제한·실행 불가를 구분해 표시한다. 원문과 요청 사본은 남는다.
- 자동 다른 제공자 전환·자동 유료 재시도는 없다. 제공자 보고 토큰만 저장하며 미보고 사용량은 null; 비용을 추정하지 않는다.
- 로컬 취소는 제공자 과금 취소를 보장하지 않는다.

## Devin 임시 기록과 Oracle

[Devin 안내](DEVIN_RUNNER.md)를 따른다. 작업별 XDG config/data/cache/state를 임시 경로에 두고 인증 파일만 참조한다. 정상 종료·오류·취소 후 owned 임시 경로를 삭제한다. 앱 DB의 요청·결과는 남는다. SIGKILL/정전/파일 시스템 오류와 제공자 측 기록 삭제는 보장하지 않는다.

기본 Docker 이미지에는 Devin/OpenCode CLI가 없다. Hive 환경변수는 개인 storage에만 전달된다. Oracle에서 Devin을 쓰려면 앱이 실행되는 실제 환경에 ARM64 CLI와 인증을 준비해야 한다. 호스트 실행 파일 경로를 컨테이너 환경변수에 적는 것만으로 설치되지 않는다. 공유 서버에는 AI 키를 주지 않는다.

## 파일 진입점

| 파일 | 역할 |
| --- | --- |
| `server/ai/hive.mjs` | Chat Completions, SSE/JSON, 취소·오류 정제 |
| `server/ai/execution.mjs` / `settings.mjs` | 등록 프로필, 설정 버전, 요청 모델 고정 |
| `server/ai/jobs.mjs` / `worker.mjs` | 사본·UUID·큐·단일 실행 |
| `shared/aiRequests.ts` | 클라이언트/서버 요청 검증 |
| `src/settings/AiSettingsPanel.tsx` | 기본·모델 설정 |
| `src/ai/AiExecutionPicker.tsx` | 요청별 실행기·모델 선택 |
| `src/ai/AiJobPanel.tsx` | 결과 우선 읽기·이력·명시 재요청 |
| `scripts/qa-ai-profiles.mjs` | 임시 DB·모의 Hive UI 검증 |

## OpenCode 모델 목록

2026-10-05에 `https://opencode.ai/zen/v1/models`에서 조회한 86개 사본에서, 무료로 확인된 **일반 텍스트 모델 11개만 초기 목록에 등록**한다. 사용자 요청으로 Jev·유료·가격 미확인 모델은 초기 등록과 공식 목록 갱신에서 제외했다. OpenCode가 지원하는 모든 제공자의 목록은 아니다. 모델 ID가 `-free`로 끝난다는 이유만으로 무료로 분류하지 않는다. 실제 사용 가능·가격·약관은 제공사 조건을 따른다. Jev는 별도 구조화 판단 API를 쓰므로 일반 텍스트 요청은 거절한다.

1. **설정 → AI → OpenCode CLI**에서 기본 모델을 선택한다.
2. **모델 목록 관리**를 열어 검색·무료 등록/사용 중 필터를 쓴다.
3. 표시 이름, `provider/model-id`, 가격 안내와 사용 여부를 수정한다. 다른 제공자 ID를 추가할 수도 있지만 해당 제공자의 CLI 지원·서버 인증은 별도로 필요하다.
4. **공식 목록 갱신**은 고정된 공식 URL에서 조회해 무료로 확인된 지원 모델만 초안에 반영한다. 기존 이름·사용 여부·가격 안내를 유지하고 새 모델은 꺼 둔다. 사라진 모델은 삭제하지 않고 표시하며, 직접 등록한 다른 제공자는 유지한다. 새 무료 모델의 가격을 현재 사본에서 확인할 수 없으면 자동 추가하지 않는다. 제공사에서 무료 여부를 확인한 뒤 모델 ID를 직접 추가할 수 있다.
5. **AI 설정 저장**을 눌러 적용한다. 설정은 개인 SQLite `ai_settings`에 저장하고 DB 백업에 포함된다. 다른 기기에서 설정이 바뀌면 409로 거절하고 초안을 유지한다.

기본 모델을 삭제하거나 끄면 선택을 비우며 다른 모델을 몰래 고르지 않는다. 이미 제출한 요청과 과거 작업 재시도는 당시 실행기·모델을 유지한다. 모델 목록 수정은 새 요청의 허용 목록을 바꾸며 과거 요청을 바꾸지 않는다. 가격 필드는 사용자가 수정하는 안내값이며 비용을 강제로 차단하는 결제 한도가 아니다.

## Oracle의 OpenCode CLI 준비

아직 Oracle 설치·ARM64 실실행은 하지 않았다. 아래는 반영할 때 쓰는 절차다.

```sh
# 실제 AI worker 환경에서 설치한다. 확인한 로컬 CLI 버전은 1.18.32다.
npm install -g opencode-ai@1.18.32
opencode --version
opencode run --help
opencode auth login
```

Docker를 쓴다면 호스트 설치만으로는 컨테이너가 실행할 수 없다. 별도 이미지에서 CLI를 설치하고 ARM64·Alpine 호환과 `--pure`, `run --format json` 지원을 확인한 뒤 실제 이미지에서 구동한다. 인증 파일은 이미지에 넣지 않고 개인 worker에만 읽기 전용으로 연결한다.

```dotenv
AI_RUNNER_KIND=hive
AI_OPENCODE_ENABLED=false
AI_OPENCODE_BIN=opencode
AI_OPENCODE_MODEL=
AI_OPENCODE_AUTH_FILE=/absolute/private/path/auth.json
```

설치·제공자 인증·사용 조건 확인 후 `AI_OPENCODE_ENABLED=true`로 바꾸고 서버를 재시작한다. 기본 실행기는 사이트의 설정에서 OpenCode를 선택하면 된다. UI 저장 전 모델 기본값은 `AI_OPENCODE_MODEL`, 저장 후에는 DB가 우선이다. 전체 AI를 끄는 `AI_RUNNER_KIND=disabled`는 계속 우선한다. 등록한 모델만으로 CLI 설치나 인증·실행이 자동으로 켜지지는 않는다.

작업마다 별도 XDG config/data/cache/state를 사용한다. 해당 제공자의 인증 항목만 임시 `auth.json`에 0600 권한으로 복사하고 원본 인증은 유지한다. 프롬프트는 셸 명령·프로세스 인자 대신 stdin으로 전달한다. `--pure`, 도구 전부 거절, 공유·자동 업데이트·자동 요약 꺼짐과 고정된 주/보조 모델을 사용한다. 홈 Claude 지침·외부 스킬도 로딩하지 않는다. 프로세스가 닫힌 뒤 정상·실패·취소의 임시 기록을 삭제하며 앱 DB의 요청·결과는 보존한다. 정전·SIGKILL이나 제공자 서버 기록 삭제는 보장하지 않는다.

Zen의 선택 모델은 고정 API 주소와 허용한 SDK로 실행 시 다시 선언한다. CLI 내부 목록 갱신이 늦어도 새 모델 ID를 전달할 수 있다. Claude는 Messages, GPT/Muse는 Responses, 나머지는 Chat Completions 규격이다. 새로운 모델이 다른 규격을 요구하면 adapter 변경이 필요하다. 다른 제공자의 ID는 해당 CLI 제공자 지원과 인증이 필요하다.

JSON 이벤트의 종료 표시·텍스트가 없거나, 길이 제한·도구 호출·오류 이벤트면 성공으로 저장하지 않는다. CLI 내부의 동일 제공자 재시도·보조 처리 횟수를 앱 작업 수로 단정하지 않는다. Hive나 유료 대체 모델로 자동 전환하는 기능은 없다.

OpenCode CLI 소프트웨어는 MIT지만 Zen/무료 모델 서비스 약관은 별도다. 서비스 약관에는 자동 출력 추출 제한 문구가 있어 자동 서버 호출의 적용 범위는 제공사 확인이 필요하다. 무료 모델 일부는 시험용으로만 허용하거나 입력을 모델 개선에 사용한다. 로컬 임시 기록 삭제가 제공자의 데이터 삭제를 뜻하지 않는다.

### 추가 파일

| 파일 | 역할 |
| --- | --- |
| `server/ai/opencode.mjs` | stdin·격리 설정·JSON 이벤트·취소와 기록 정리 |
| `server/ai/cliProcess.mjs` | Devin/OpenCode의 프로세스 그룹 종료·용량 제한 |
| `server/ai/modelCatalog.mjs` / `opencodeModels.json` | 목록 검증·공식 목록 조회·초기 86개 사본 |
| `shared/aiModels.ts` | 목록 갱신 시 사용자 수정 보존 |
| `src/settings/OpenCodeModels.tsx` | 목록 관리·기본 모델 선택 |
| `scripts/qa-opencode-models.mjs` | 임시 DB·가짜 CLI·PC/모바일 동작 검증 |

공식 근거: [모델 목록](https://opencode.ai/zen/v1/models), [CLI](https://opencode.ai/docs/cli/), [모델 ID](https://opencode.ai/docs/models/), [무료 모델·개인정보](https://opencode.ai/docs/zen/), [서비스 약관](https://opencode.ai/legal/terms-of-service), [MIT 라이선스](https://github.com/anomalyco/opencode/blob/dev/LICENSE).

## 서비스 Telegram 알림

개인 AI worker의 실행 시작·확정 실패 알림은 [서비스 알림 설정](SERVICE_NOTIFICATIONS.md)을 따른다. 기본 꺼짐이며 비밀 환경 파일을 명시적으로 읽혀 새 프로세스를 실행해야 한다. 모델·템플릿·선택적인 앞 80글자와 HTTPS 요청 링크를 보내고, 외부 오류 원문은 보내지 않는다. 제한된 메모리 큐의 best effort 전송으로 AI 처리를 지연시키지 않는다.
