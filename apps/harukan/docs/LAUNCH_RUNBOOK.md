# Oracle / Cloudflare 전환 절차

작성: 2026-10-11, 갱신: 2026-10-12. 반복 가능한 실행 절차이며 실제 적용 결과는 실행 기록(비공개 repo `private/planner/docs/LAUNCH_EXECUTION.md`)을 확인한다.

## 주소와 서비스 분리

| 주소 | 역할 | Oracle 내부 연결 |
|---|---|---|
| personal.leneu.store | 기존 개인 Anotar, 기존 비밀번호+TOTP 유지 | 127.0.0.1:8787 |
| harukan.leneu.store | harukan 소개·계정·시간표 (2026-10-18부터 기본 주소) | 127.0.0.1:8794 |
| leneu.store | 예전 harukan 주소. 같은 앱이 받아 `harukan.leneu.store`의 같은 경로로 301 (`REDIRECT_FROM_HOSTS`) | 127.0.0.1:8794 그대로 |
| share.leneu.store | 기존 공유 페이지 | 127.0.0.1:8790 그대로 |
| host.leneu.store | 기존 웹 호스팅 | 127.0.0.1:8792 그대로 |

기존 DB·첨부 `/srv/leneu/data-live`, 기존 인증·AI·봇·자동 배포는 그대로 사용한다. 새 플래너는 `/srv/anotar-planner/data`, `/srv/anotar-planner/backups`, 별도 Compose 프로젝트와 host-only 쿠키를 쓴다. 포트 8794를 인터넷에 직접 열지 않는다. Cloudflare tunnel 서비스 토큰을 출력하거나 저장소에 올리지 않는다.

## 0. harukan.leneu.store 주소 추가 (2026-10-18)

1. Cloudflare Zero Trust › Tunnels › 기존 tunnel › Public Hostname에 `harukan.leneu.store` → `http://127.0.0.1:8794`를 추가한다(DNS CNAME은 Cloudflare가 만든다). `leneu.store` 경로는 지우지 않는다. 두 경로 모두 HTTP Host header를 바꾸지 않는다(기본값) — 앱이 Host로 예전 주소를 알아본다.
2. `/srv/anotar-planner/.env`에서 `PUBLIC_ORIGIN=https://harukan.leneu.store`, `REDIRECT_FROM_HOSTS=leneu.store`로 바꾸고 재시작한다. 가입·재설정 메일 링크와 쓰기 요청의 Origin 검사가 새 주소 기준이 된다. 보내는 주소(`MAIL_FROM`, `no-reply@leneu.store`)는 그대로 둔다.
3. 확인: `curl -sI https://leneu.store/app?x=1` → `301`, `location: https://harukan.leneu.store/app?x=1`. 새 주소에서 가입·로그인·메일 링크.
4. 쿠키는 host-only라 예전 주소의 로그인은 옮겨지지 않는다. 새 DB로 출시하면 영향 없음. 운영 anotar의 사이드바·`/journal` 기본값은 `https://harukan.leneu.store/app`이다. 예전 anotar 경로(`/pages`, `/memo`, `/tasks`…)는 `PERSONAL_ORIGIN`(기본 `https://anotar.leneu.store`)으로 302한다.

2026-10-18 출시의 실제 순서·확인·되돌리기는 비공개 `private/docs/deploy/launch-20261018.md`에 있다.

## 1. SSH 접속 복구

로컬 `.env.oracle-server`의 호스트·사용자·키를 사용한다. 이 파일을 배포 묶음이나 문서에 포함하지 않는다. 시간 초과는 비밀번호 오류와 다르다.

Oracle 콘솔에서 Osaka 지역, 해당 인스턴스 RUNNING, VNIC의 현재 공인 IP와 예약 주소, 보안 목록/NSG, OS 방화벽 상태를 확인한다. SSH ingress가 현재 관리자의 주소를 포함하는지 확인하고 필요한 경우 현재 주소 /32에 TCP 22만 허용한다. 전체 인터넷에 SSH를 개방하거나 인스턴스를 재생성하지 않는다. 새 공인 IP이면 로컬 접속 설정만 올바르게 업데이트한다. 콘솔 연결이나 기존 관리 터널이 있으면 이를 활용한다.

## 2. 전환 전 자료 확인

기존 루트 주소의 로그인된 브라우저에서 변경 알림·전송 대기·충돌을 확인한다. 서버에 아직 반영되지 않은 기기 초안을 내보내거나 반영한다. 서버 DB와 첨부 백업을 기존 운영 절차로 만든다.

**도메인을 바꾸면 브라우저의 IndexedDB·로컬 초안·로그인 쿠키는 옮겨지지 않는다.** 서버 자료는 그대로지만 미전송 기기 변경은 이전 주소에만 있다. 새 플래너는 기존 저장소를 지우지 않는다. 이전 서비스 워커/PWA도 남아 있을 수 있어, 전환 뒤 온라인에서 페이지를 갱신하고 새 앱 응답을 확인한다. 전체 사이트 데이터 삭제로 문제를 해결하지 않는다. 기존 PWA를 쓰던 기기는 새 personal 주소를 열고 새로 로그인한다.

## 3. 새 플래너 배포

`npm test`, `npm run build`, 임시 DB 브라우저 QA를 통과한 소스를 **허용 목록으로만** 묶는다. package*.json, index.html, tsconfig/vite 설정, src/, public/, server/, scripts/backup.mjs, scripts/restore.mjs, Dockerfile, .dockerignore, compose.oracle.yaml, deploy/, README·PRODUCT·DESIGN과 운영 문서만 필요하다. .env, 개인 앱 data, .omo, .npm-cache, node_modules, 계정 자료를 포함하지 않는다. 새 공개 GitHub 저장소를 임의로 만들지 않는다.

Oracle 예시:

```sh
sudo install -d -m 700 -o 1000 -g 1000 /srv/anotar-planner/data /srv/anotar-planner/backups
sudo install -d -m 755 /srv/anotar-planner/releases
```

소스를 `/srv/anotar-planner/releases/<release-id>`에 업로드하고 `/srv/anotar-planner/current`로 연결한다. 환경 파일 `/srv/anotar-planner/.env`는 읽기 권한 600으로 보관한다.

후속 배포는 먼저 현재 서비스에서 온라인 백업을 만든다. 새 릴리스에 기존 환경 파일의 심볼릭 링크를 만들고 **정확한 새 `PLANNER_RELEASE` 이미지 태그로 빌드**한다. 빌드 성공 뒤 환경 파일의 릴리스 키와 current 링크를 원자적으로 바꾸고 Compose를 실행한다. 다른 환경 키나 데이터 경로는 덮어쓰지 않는다. health 실패 시 previous 이미지·current·릴리스 키를 되돌리고 데이터는 초기화하지 않는다.

```dotenv
PUBLIC_ORIGIN=https://harukan.leneu.store
REDIRECT_FROM_HOSTS=leneu.store
REGISTRATION_ENABLED=false
LEGAL_REVIEWED=false
OPERATOR_NAME=문성혁
OPERATOR_REPRESENTATIVE=개인 운영
CONTACT_EMAIL=support@leneu.store
PRIVACY_CONTACT=문성혁
LEGAL_PUBLISHED_AT=
HOSTING_REGION=
```

현재 소스와 운영 파일을 확인한 뒤 실행한다.

```sh
cd /srv/anotar-planner/current
sudo docker compose -f compose.oracle.yaml build
sudo docker compose -f compose.oracle.yaml up -d
curl --fail http://127.0.0.1:8794/api/health
```

HTTP health만으로 가입·자료 격리가 검증됐다는 뜻은 아니다. 로컬 fixture QA 증거와 운영의 미로그인 자료 API 401, 읽기용 사이트 설정, HTML을 함께 확인한다. 운영 계정을 임의 생성하지 않는다.

## 4. personal 주소 먼저 연결

기존 `/srv/leneu/app/.env`의 `PRIVATE_ALLOWED_ORIGINS`에 **기존 값들을 보존하면서** `https://personal.leneu.store`를 추가한다. 전환 기간에는 기존 root 출처도 유지한다. 기존 서비스의 환경 파일을 덮어쓰지 않고 필요한 두 키만 수정한다. `SERVICE_TELEGRAM_APP_URL`은 personal 주소로 바꾼다. 기존 릴리스 경로와 Compose 환경 호출 방법은 개인 앱의 [운영 배포 가이드](../../anotar/docs/ORACLE_RELEASE_GUIDE.md)를 따른다.

Cloudflare Zero Trust의 기존 `anotar-oracle` tunnel에 Published application route `personal.leneu.store` → HTTP `127.0.0.1:8787`를 추가한다. Tunnel DNS CNAME도 확인한다. share·host 연결을 편집하지 않는다. personal에서 HTML, 인증 상태와 **미로그인 개인 API 401**을 확인하고 기존 인증으로 로그인해 자료를 확인한다. 로그인 새 설정이나 비밀번호 초기화가 뜨면 전환을 진행하지 않는다.

개인 앱의 환경 변경을 반영할 때는 실행 중인 컨테이너의 Compose project·설정 파일·image를 먼저 확인한다. 이번 전환의 project는 `app`, 설정은 `compose.yaml`과 `compose.oracle.yaml` **둘 다**, 기존 image는 `anotar:5175e914f4ed128b20217cf7bfdf45de8379bfcf`였다. `LENEU_IMAGE`를 생략하면 기본 local image가 선택되고 project를 생략하면 다른 스택이 만들어질 수 있다. 기존 릴리스에서 다음과 같이 정확히 재생성하고 image·원본 마운트·포트를 다시 확인한다.

```sh
cd /srv/leneu/current
sudo env LENEU_IMAGE=anotar:5175e914f4ed128b20217cf7bfdf45de8379bfcf docker compose -p app -f compose.yaml -f compose.oracle.yaml up -d --no-build --no-deps storage
```

위 태그는 이번 실행의 값이다. 다음 작업에서는 그때 실행 중인 태그를 확인해 사용한다.

## 5. root 주소 전환

새 플래너 health와 personal 읽기/인증이 정상인 뒤 기존 root tunnel route의 서비스만 `http://127.0.0.1:8794`로 바꾼다. root DNS는 같은 tunnel을 쓰므로 CNAME을 삭제할 필요가 없다. 루트에는 기존 개인 API를 프록시하지 않는다.

검증:

- root `/` 소개, `/demo` 체험, `/privacy` 실제 상태, `/login` 새 계정 로그인.
- 미로그인 root `/api/days/2026-10-11`은 401. 예전 `/api/pages`도 새 서비스에서 공개하지 않는다.
- root 예전 `/pages/:id`, `/journal`, `/memo`, `/tasks` 북마크는 personal 같은 경로로 302 이동한다.
- personal 기존 로그인·자료 읽기/쓰기, share 토큰 페이지, host 정적 페이지는 정상.
- 기존 root 서비스 워커가 설치된 브라우저에서도 실제 온라인 응답과 새 자산 로딩을 확인한다. 예전 IndexedDB를 삭제하지 않는다.

전환 확인 뒤 개인 앱 허용 출처에서 기존 root를 제거한다. `www` 등 실제 별도 DNS가 있으면 독립적으로 목적지를 확인하고 필요한 경우 root로 안내한다.

## 6. 백업과 정책 게시

```sh
sudo install -m 644 deploy/anotar-planner-backup.service /etc/systemd/system/
sudo install -m 644 deploy/anotar-planner-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now anotar-planner-backup.timer
sudo systemctl start anotar-planner-backup.service
```

백업 자체에는 민감한 계정 자료가 있다. 파일600·폴더700과 별도 임시 DB 복구를 확인한다. 7일 지난 사본은 다음 백업 실행 때 정리한다. 시스템이 장기간 꺼져 있으면 재시작 시 timer와 정리 동작을 확인한다. 개인 Anotar 백업을 이 폴더에 넣지 않는다.

복원은 운영 앱을 중지하고 현재 데이터 사본과 **현재 `/data/deletions.json`**을 먼저 보관한다. 원래 백업·현재 데이터를 덮어쓰지 않는다.

```sh
node scripts/restore.mjs <backup.sqlite> <존재하지-않는-새-복원-디렉터리> <현재-data-디렉터리>
```

이 명령은 integrity_check, 현재 탈퇴 기록 적용, 모든 세션 폐기를 수행한다. 새 복원 디렉터리의 소유자와 권한을 확인하고 DB를 교체하되 현재 삭제 기록은 유지한다. 사용자별 기록 일부 삭제는 현재 제품에 별도 이력이 없으므로, 탈퇴 외 개별 기록 삭제가 있었다면 운영 사본과 비교해 다시 적용한다. 장애 복구는 과거 시점 복원이므로 이후 편집도 사본에서 검토한다.

[공개 운영 정보](PUBLIC_INFORMATION.md)를 모두 확인한 뒤 정책 시행일·호스팅 지역·최종 정책 내용과 `LEGAL_REVIEWED`를 맞춘다. 확인된 최종 게시 후에 `REGISTRATION_ENABLED=true`를 적용한다. 운영자 답변만으로 서버 지역·계약 완료를 추정하지 않는다.

## 7. support 수신 메일

Cloudflare Email Routing에서 leneu.store 도메인을 활성화한다. 기존 MX/SPF가 있으면 충돌·기존 수신 서비스 사용 여부를 먼저 검토한다. UI가 제시하는 MX 3개, SPF, DKIM 레코드를 추가한다. 전달 대상은 사용자가 지정한 Gmail이며 그 주소의 인증 메일 링크는 본인이 누른다.

인증된 목적지를 고르고 custom address **support**를 만들고 활성화한다. Catch-all은 따로 요청받지 않았으므로 끈다. DNS와 규칙이 Active인지 다시 조회하고, 목적지 Gmail과 다른 메일함에서 support 주소로 시험 발신한다. 자동 설정 저장만으로 실제 수신 완료라고 쓰지 않는다.

이 설정은 수신 전달이다. support 주소로 답장·발신하려면 별도 발신 제공자/SMTP 또는 사용 가능한 Cloudflare Email Sending 설정과 도메인 인증이 필요하다. Gmail 개인 주소로 보낸 답장은 support 발신으로 표시되지 않는다. 발신 서비스를 계약·구매하거나 추가 요금을 승인 없이 도입하지 않는다.

## 장애와 되돌리기

root에만 장애가 있으면 tunnel root route를 이전 8787로 되돌린다. personal alias와 새 플래너 DB를 삭제하지 않는다. 새 코드 오류는 previous 릴리스의 Compose image/source로 되돌리고 DB를 임의 초기화하지 않는다. 정책/가입 문제가 있으면 가입 플래그를 false로 내리고 이미 가입한 자료는 유지한다.

실제 변경 날짜, 릴리스 ID, 적용 키(값/비밀 제외), 네 주소 상태, 메일 인증·규칙·시험 수신, 남은 미확정 항목을 별도 실행 기록에 남긴다.
