# 개인 계정 · 로그인 · 오프라인 보존

2026-10-04. 개인 계정 하나를 위한 구현이다. 공개 가입은 없고, 공유 링크 방문자는 이 계정으로 로그인하지 않는다. 실제 Oracle/Vercel 배포나 휴대폰 Authenticator 등록은 아직 수행하지 않았다.

## 처음 설정하기

프로젝트의 `leneu-storage/`에서 Node.js 24로 실행한다. **비밀번호나 복구 코드를 채팅·명령 인수·환경변수에 입력하지 않는다.**

```bash
npm run auth:setup
```

1. 터미널에서 8자 이상의 비밀번호를 입력하고 확인한다. 화면에는 표시되지 않는다.
2. Google Authenticator의 `+ → 설정 키 입력`에서 터미널에 표시된 키를 등록한다. 이름은 `leneu`, 유형은 **시간 기반**이다.
3. 앱의 6자리 코드를 터미널에 입력한다. 코드가 맞아야 계정을 저장한다. 사용한 코드는 다음 로그인에 재사용할 수 없으므로 다음 코드로 로그인한다.
4. 터미널에 한 번 표시되는 **일회용 복구 코드 10개**를 비밀번호 관리자 등 안전한 곳에 보관한다. DB에는 해시만 저장하므로 원본 코드를 다시 조회할 수 없다.
5. `.env`에 생성된 `AUTH_SECRET_KEY`를 DB 백업과 별도로 안전하게 보관한다. 파일 권한은 `0600`이다. 실제 `.env`는 Git·공개 페이지에 넣지 않는다.
6. 실행 중인 개발 서버를 재시작한다. `npm run dev` 또는 `npm start`의 새 프로세스가 `.env`를 읽는다.

설정 명령은 기존 계정을 덮어쓰지 않는다. 실제 `DATA_DIR`와 기존 `.env`를 확인하고 실행한다. 계정 설정은 기존 메모·페이지·첨부를 삭제하지 않는다. 초기 설정 키는 수동 입력 방식이며 QR 등록 화면은 아직 없다.

### Docker에서 처음 설정하는 경우

호스트에 Node24가 없으면 앱 이미지의 로컬 대화형 CLI를 사용할 수 있다. 이미지 빌드 후 프로젝트의 비공개 `.env`와 실제 데이터 경로를 사용한다. **개인 앱을 외부에 연결하기 전에** 실행한다.

```bash
docker compose build storage
# 프로젝트 폴더에서 수행. 경로는 실제 운영 경로로 바꾼다.
touch .env
chmod 600 .env
docker run --rm -it --user "$(id -u):$(id -g)" --env-file .env \
  -e DATA_DIR=/data -e HOST=0.0.0.0 \
  -v /srv/leneu/data:/data \
  -v "$PWD":/config \
  -w /config leneu-storage:local \
  node /app/scripts/auth-setup.mjs
docker compose up -d --force-recreate storage
```

초기 설정은 해당 사용자에게 쓰기 권한이 있는 데이터 폴더에서 앱 시작 전에 실행한다. 이미 Docker가 생성한 데이터 폴더라면 서비스를 중지하고 폴더 소유권·권한을 먼저 확인한다. 환경 파일이 root 소유로 바뀌어 다음 Compose 실행에서 읽지 못하는 일을 막기 위해 CLI는 현재 사용자 UID/GID로 실행한다.

이미지 이름을 변경했다면 `leneu-storage:local`도 변경한다. CLI는 `/config/.env`를 보호된 새 파일로 저장하므로 파일 하나보다 폴더를 마운트한다. Docker 환경은 Secure 쿠키를 강제하며, 로그인 화면은 실제 HTTPS 주소에서 사용한다. HTTP loopback의 `/api/health`만으로 로그인·키 설정이 완료됐다고 판단하지 않는다.

## 일상 사용

- 로그인: **비밀번호 + Google Authenticator**. 휴대폰을 잃었다면 비밀번호와 일회용 복구 코드로 로그인한다.
- **이 브라우저를 30일 동안 기억하기**는 본인 기기에서만 선택한다. 브라우저/PWA 저장 공간에 묶이며 물리 기기 지문을 수집하지 않는다.
- 일반 세션은 12시간. 기억한 브라우저의 유효한 쿠키가 있으면 새 세션으로 갱신한다. 기억 기간은 최초 로그인부터 최대 30일이며, 7일간 사용하지 않으면 다시 인증한다.
- 복구 코드 로그인은 기억한 기기를 발급하지 않는다. 복구 코드는 사용 즉시 폐기한다.
- **설정 → 보안**에서 현재/다른 브라우저의 마지막 사용·만료와 남은 복구 코드 개수를 확인하고 로그아웃한다.
- 다른 브라우저/전체 로그아웃은 인증 코드를 다시 확인한다. Authenticator를 잃었다면 **복구 코드로 확인**으로 일회용 코드를 사용할 수 있다. 이미 사용한 코드가 아닌 다음 코드를 입력한다. 서버는 5분 이내의 MFA 확인만 허용한다.
- 실패 5회 후 15분 동안 로그인 확인을 제한한다. 한 사람용 서비스라 계정 전체 제한도 적용한다.

인증 앱 변경·비밀번호 변경·복구 코드 재발급 UI는 이번 버전에 포함하지 않는다. 복구 코드와 등록한 Authenticator를 안전하게 보관한다. 코드를 잃은 상태에서 DB나 인증 테이블을 임의로 삭제하지 않는다.

## 오프라인과 로그아웃

처음 접속한 브라우저는 온라인 로그인이 필요하다. 이미 준비한 기기에서는 서버 연결이나 세션이 만료돼도 로컬 메모·페이지와 첨부를 계속 사용할 수 있다. 서버 인증이 거절되면 동기화를 멈추고 로그인 안내를 표시한다. 재로그인 후 기존 UUID로 같은 전송 대기열을 재개한다.

명시적 로그아웃은 작업 공간을 가리고, 다시 열어도 로그인 화면을 유지한다. 작성 중인 편집기를 해제하거나 로컬 원문·초안·첨부·전송 대기 자료를 지우지 않는다. 로그인 후 작업을 이어갈 수 있다. 다른 탭에도 로그인/로그아웃 상태를 전달한다.

**원격 로그아웃은 서버 접근만 끊는다.** 이미 다운로드된 IndexedDB 데이터의 원격 삭제나 암호화된 오프라인 잠금을 제공하는 것은 아니다. 기기 자체의 화면 잠금/디스크 보호도 사용한다.

## 운영 경계와 설정

| 설정 | 동작 |
| --- | --- |
| `AUTH_MODE=required` | 개인 API에 인증 필요. 키/계정이 없으면 `503`, 유효 세션이 없으면 `401` |
| `AUTH_MODE=disabled` | 격리된 로컬 개발·기존 QA 전용. 공개 운영에서 사용하지 않음 |
| `AUTH_SECRET_KEY` | TOTP 암호화용 무작위 32바이트 hex. 개인 서버에만 전달 |
| `AUTH_COOKIE_SECURE=true` | 기본. `__Host-` 쿠키, HttpOnly/Secure/SameSite=Strict/Path=/, Domain 없음 |
| `AUTH_COOKIE_SECURE=false` | 로컬 loopback 개발만 허용. 외부 HOST나 production에서는 시작 거부 |
| `PRIVATE_ALLOWED_ORIGINS` | 허용할 실제 개인 HTTPS Origin. 쉼표 구분, 경로·마지막 슬래시 없음 |

설정하지 않으면 production·외부 HOST는 `required`, loopback 개발은 `disabled`다. Compose는 기본 `required`와 Secure 쿠키를 사용한다. 계정이 없을 때 개인 API를 임시로 여는 방식으로 배포하지 않는다.

`GET /api/auth/status`는 활성/설정/로그인 여부만 반환한다. `/api/health`와 정적 앱 셸은 인증 없이 열리며 개인 데이터는 포함하지 않는다. `/api/auth/login` 외의 개인 `/api/*`는 첨부 다운로드·업로드·AI·백업·동기화를 포함해 앞단에서 보호한다. Cookie만 있어도 쓰기 Origin이 없거나 허용되지 않으면 거절한다.

Vercel/PWA와 Oracle은 **브라우저에서 같은 Origin의 `/api/*`를 사용하는 프록시 구조**로 연결한다. Oracle 원본 접근 제한·프록시 Host/Origin·HTTPS·쿠키 전달·첨부 크기·PWA 갱신을 실제 배포 때 확인한다. 직접 교차 Origin API용 CORS는 구현하지 않았다. 인증 코드 추가만으로 Vercel·Oracle 네트워크가 연결된 것은 아니다. 기존 Tailscale 안내는 다른 운영 선택지이며, 공유 서버 8790을 개인 API 프록시로 사용하지 않는다.

공개 `share` 프로세스에는 개인 인증 API나 암호화 키를 전달하지 않는다. 읽기 전용 공유 출시와 독립 HTML 호스팅은 후속이다.

## 저장 · 백업 · 복원

SQLite의 `auth_*` 테이블은 서버에만 존재하고 검색·동기화 목록·공개 HTML에 들어가지 않는다. 비밀번호는 async scrypt(N=131072,r=8,p=1)로, 세션·기기 토큰과 복구 코드는 SHA256 해시로 저장한다. TOTP 키는 AES-256-GCM으로 암호화한다.

DB 전체 백업에는 암호화된 인증 자료도 포함된다. `.env`의 **동일한 AUTH_SECRET_KEY**가 없으면 TOTP 인증을 복원할 수 없다. 키를 공개 백업 폴더에 함께 저장하지 않고 별도 보호된 위치에 보관한다. 새 경로로 복원하면 sync epoch가 바뀌므로 이전 세션과 기억한 기기는 무효가 되고 다시 로그인한다.

## 확인 범위

`npm test`, `npm run build`, `npm run qa:auth`로 임시 DB·Chrome에서 확인한다. Authenticator는 RFC6238의 공개 벡터와 생성 코드를 사용한다. 실제 휴대폰 등록/키보드, 브라우저별 PWA 쿠키 정책, HTTPS 프록시, 운영 서버 재시작/복원은 별도 확인이 필요하다.

구현 계약: [설계](superpowers/specs/2026-10-04-private-auth-design.md) · [실행 계획](superpowers/plans/2026-10-04-private-auth.md). 기준: [RFC6238](https://www.rfc-editor.org/rfc/rfc6238), [OWASP 비밀번호 저장](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP 세션 관리](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
