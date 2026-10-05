# Devin CLI 실행기 설정과 로컬 기록 정리

2026-10-05. Hive 기본과 Devin 선택 실행기를 구현했다. 설정 → AI에서 기본 실행기·모델을 저장하고 요청 옆에서 선택한다. 이번 변경에는 Devin 임시 기록 격리와 Hive 직접 어댑터가 포함된다.

## 현재 동작

- 작업마다 별도 임시 폴더를 만든다.
- XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, XDG_STATE_HOME을 그 안에 둔다. 세션 SQLite DB·CLI 로그·캐시를 기존 사용자 기록과 분리한다.
- CLI credentials.toml만 기존 로그인 파일을 가리키는 심볼릭 링크로 연결한다. 비밀정보를 환경변수나 요청 본문으로 전달하지 않는다.
- 정상 완료·잘못된 응답·실행 실패·시간 초과·취소 후 finally에서 작업 폴더와 로컬 기록을 지운다. 로그인 원본과 다른 Devin 세션은 삭제하지 않는다.
- anotar의 요청 사본·모델 표시·결과·실행 상태는 남긴다. 이는 CLI 기록과 별개다.
- 프로세스 강제 종료(SIGKILL), 전원 장애, 디스크 삭제 실패에서는 즉시 삭제를 보장하지 않는다. 재부팅 시 지워지는 전용 tmpfs를 운영에 사용할 수 있다. 기존 사용자 전역 기록을 일괄 삭제하는 정리기는 사용하지 않는다.
- 제공자 측 로그·보관 데이터 삭제를 의미하지 않는다. CLI 파일 삭제는 안전한 디스크 완전 소거와도 다르다.

## 실행 설정

```dotenv
AI_DEVIN_BIN=devin
AI_DEVIN_MODEL=swe-2-high
AI_DEVIN_CREDENTIALS_FILE=
```

로그인 파일 기본 경로는 해당 실행 계정의 `$XDG_DATA_HOME/devin/credentials.toml` 또는 `~/.local/share/devin/credentials.toml`이다. 별도 경로가 필요하면 AI_DEVIN_CREDENTIALS_FILE에 절대 경로만 적는다. 위 설정만으로 기본 실행기가 Devin으로 바뀌지는 않는다.

`AI_RUNNER_KIND=hive`로 Hive 기본과 Devin 선택을 함께 사용할 수 있다. `disabled`는 서버 전체 실행 차단이고 UI에서 해제할 수 없다. `.env`에 보관한 키·모델은 덮어쓰지 않았다. 모델 설정을 UI에서 저장하면 DB 값이 환경 기본값보다 우선한다.

## Oracle에서 해야 할 설치·인증

1. 서버 SSH 접속 후 Ubuntu ARM64 환경과 실제 앱 실행 계정을 확인한다.
2. 공식 Devin CLI 설치 절차를 해당 전용 계정으로 실행한다. `devin version`과 `devin auth login --help`로 설치 버전과 인증 방식을 확인한다.
3. 서버의 해당 계정에서 로그인한다. 로컬 Mac 인증 파일을 임의로 서버에 복사하지 않는다. 원격 인증이 필요하면 CLI가 안내하는 인증 절차를 사용한다.
4. `devin auth status`, `devin models list --format json`으로 로그인과 모델 사용 가능 여부를 확인한다. 모델 목록은 실제 작업 성공·사용료 보장을 뜻하지 않는다.
5. 앱 프로세스가 위 실행 파일과 로그인 파일에 접근할 수 있게 설정한다. root 대신 전용 계정을 쓰고 운영 DB·설정과 실행 권한을 분리한다.
6. Docker의 현재 기본 이미지에는 Devin CLI가 없다. 호스트에 설치한 경로를 컨테이너의 AI_DEVIN_BIN에 적는 것만으로 동작하지 않는다. 컨테이너 내 CLI·인증 경로 또는 별도 실행 서비스 연결이 필요하다.
7. 합성 입력으로 한 번 실행하고 결과·취소·임시 기록 삭제를 확인한 후 활성화한다. 실제 요청은 제공자 사용량을 소비할 수 있다.

## 이번에 확인한 범위

Mac에 설치된 Devin 3000.11.3에서 격리된 XDG 경로로 `list --format json`과 `auth status`를 실행했다. 세션 DB·로그·캐시 생성 위치가 임시 경로이고 로그인 참조가 인식되는 것을 확인했다. 실제 모델 요청은 하지 않았다. Oracle 설치·로그인·ARM64 실호출은 서버 접속 주소 확인 후 진행해야 한다.

공식 참고: https://docs.devin.ai/cli/index · https://docs.devin.ai/cli/reference/configuration/config-file · https://docs.devin.ai/cli/reference/commands
