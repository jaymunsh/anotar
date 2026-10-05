# 서비스 Telegram 알림

Oracle 비용/자원 보고 방과 서비스 CPU·메모리·디스크·AI 알림 방을 분리한다. 실제 봇 토큰/chat ID는 Git 제외 파일과 서버 root credential에만 보관한다.

## AI 알림

개인 서버 `server/serviceNotifications.mjs`가 단일 worker의 **실행 시작**과 **확정된 실패**를 알린다. 보관/대기열 등록 즉시 알림, 완료 알림, 재시작으로 중단된 기존 작업 알림은 이번 범위에 없다. 모델·템플릿 이름은 제출 당시 사본에서 읽고 실패 사유는 고정 오류 코드 안내만 보낸다.

| 변수 | 기본 | 역할 |
| --- | --- | --- |
| SERVICE_TELEGRAM_ENABLED | false | true일 때 활성화 |
| SERVICE_TELEGRAM_BOT_TOKEN | 빈 값 | 서버에서만 사용하는 봇 키 |
| SERVICE_TELEGRAM_CHAT_ID | 빈 값 | 서비스 그룹 |
| SERVICE_TELEGRAM_PREVIEW | false | 요청 앞 80글자; 더 길면 … |
| SERVICE_TELEGRAM_APP_URL | 빈 값 | HTTPS 개인 앱 origin, 요청 상세 링크 |

흔한 키/토큰·비밀번호·Authorization·JSON 키를 **잘라내기 전에** 가린다. 개인정보와 모든 비밀 형식을 탐지하는 기능은 아니다. 그룹에 본문을 보내고 싶지 않으면 PREVIEW=false로 둔다. Telegram에 전달된 메시지는 앱/CLI 세션 정리와 별개로 그룹에 남는다.

알림은 최대 40개 메모리 대기열과 3초 제한의 순차 POST를 쓴다. AI 처리는 알림 전송을 기다리지 않는다. 외부 오류 원문/토큰 URL은 로그에 남기지 않고 고정 코드를 남긴다. 전송 실패·서버 종료·대기열 초과 때 유실될 수 있으며 자동 재시도/재시작 재전송은 없다. 큐가 가득 차거나 Telegram이 실패했다는 것 자체를 같은 실패 중인 Telegram 경로로 보장해서 알릴 수는 없다.

## 비밀 설정 읽기

`.env.service-alerts`는 자동으로 읽히는 파일이 아니다. 새 프로세스를 다음처럼 띄워야 한다(작업 디렉터리 leneu-storage).

```sh
node --env-file=.env --env-file=.env.service-alerts server/index.mjs
# 또는 Oracle Compose
# 보호된 실제 파일에 ENABLED=true와 HTTPS 앱 URL을 정한 다음 실행
docker compose --env-file .env --env-file .env.service-alerts up -d --build
```

공개 share/host 프로세스에는 이 환경값을 전달하지 않는다. `.env`에 이미 같은 변수가 있다면 뒤 env 파일의 우선순위를 검토한다. 실제 운영 활성화와 연결 시험 메시지를 구분한다.

## 서버 감시

[운영 스크립트](../../ops/oracle/README.md)의 systemd 5분 서비스 감시/30분 클라우드 감시를 사용한다. 서비스 감시는 CPU·메모리·디스크 경고만 하며 OCI 비용/자원 기준의 자동 정지는 별도 고정 대상 코드에서 처리한다. 서버를 멈추면 이 서버에서 도는 감시도 중단된다.
