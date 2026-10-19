# 환경 설계: 로컬과 운영

기준: 2026-10-19. 공개 문서라 값과 서버 내부 경로는 적지 않고 **키 이름과 구조만** 적는다. 전체 구성은 [architecture.html](architecture.html)을 본다.

## 원칙

1. **원본은 운영 서버 하나.** anotar는 온라인 전용이라 로컬 환경은 원본이 아니다. 로컬에서 고친 데이터는 운영으로 올라가지 않는다.
2. **로컬 환경은 목적별로 나누고 포트를 겹치지 않는다.** 아래 표에 없는 조합은 만들지 않는다.
3. **코드 기본값은 "로컬에서 안전한 값"**이다(AI 꺼짐, 운영 주소 기본). 운영은 서버 `.env`와 `compose.oracle.yaml`이 명시한다.
4. **비밀값은 git 밖 `.env` 두 곳에만**(로컬, 서버) 둔다. 서버 밖 보관은 비밀번호 관리자.

## 환경 한눈에

| 환경 | 명령 | 주소 | 데이터 | 로그인 | AI | 백그라운드 작업¹ | 위키 | 언제 |
|---|---|---|---|---|---|---|---|---|
| anotar 개발 | `apps/anotar`: `npm run dev` | 화면 5173, API 8787, 호스팅 8792² | `apps/anotar/data` | `.env`의 `AUTH_MODE`. 끄려면 `AUTH_MODE=disabled npm run dev` | `.env` 따라 | 켜짐 | `data/memory/site/data.json` | 화면·기능 개발 |
| anotar 운영 사본 | `npm run dev:oracle` | 화면 5174, API 8788, 공유 8791 | `.local-workspace/`(운영 백업을 복원한 것) | 끔 | 기본 끔. 켜면 OpenCode 무료 모델만 | 끔 | 같음 | 운영 데이터로 확인. `.env`를 읽지 않음 |
| 다음 운영 구성 시험 | `infra/personal`, `infra/public` Docker | `anotar.localhost:8780`, 공유 8790, 호스팅 8792 | `infra/personal/.local` | 켬 | `.env` 따라 | 켜짐 | memory 컨테이너 | `infra/` 구성을 바꿀 때만 |
| 자동 검사 | `npm run qa`, `npm test` | 임시 8789, 8799 | 임시 폴더(끝나면 지움) | 검사마다 | 끔(가짜 실행기) | 끔 | — | 커밋 전 |
| harukan 개발 | `apps/harukan`: `npm run dev` + `npm start` | 화면 5175, API 8794 | `apps/harukan` 아래 data | 가입·로그인 | 없음 | 없음 | — | harukan 개발 |

¹ 자동 백업, OCR, 알림. `BACKGROUND_WORKERS_ENABLED=false`로 끈다.
² Docker 공유 스택이 8792를 쓰고 있으면 `SITES_PORT=8793 npm run dev`.

## 운영

| 서비스 | 구성 | 설정이 정해지는 순서 (뒤가 이김) |
|---|---|---|
| anotar 개인·공유·호스팅 | `apps/anotar/compose.yaml` + `compose.oracle.yaml`, main push로 자동 배포 | 코드 기본값 → `compose.yaml` 기본값 → `compose.oracle.yaml`(자원 제한, 위키 파일) → 서버 `.env` |
| harukan | `apps/harukan/compose.oracle.yaml`, 런북으로 직접 배포 | 코드 기본값 → 서버 `.env` |
| 위키 | 서버에는 `data.json` 파일만 읽기 전용으로 붙임 | Mac이 만들어 올림(⑤, 아직 없음) |

운영과 로컬이 일부러 다른 것:

| | 로컬 개발 | 운영 |
|---|---|---|
| 로그인 | 끌 수 있음 | 켬. `AUTH_MODE`가 비어 있으면 production·외부 주소에서 자동으로 켜짐. 단 `AUTH_MODE=disabled`를 명시하면 운영에서도 꺼짐(아래 '정할 것' 5) |
| 쿠키 | `AUTH_COOKIE_SECURE` 끔 가능 | Secure |
| AI | 기본 `disabled` | Hive + OpenCode |
| 자동 백업 | 켜짐(설정 화면에서 켜야 실행) | 같음. 출시 뒤 Google Drive 사본 추가 |
| 위키 데이터 | repo의 `data/memory/site/data.json` | 서버의 읽기 전용 파일 |

## 비밀값 목록 (키 이름만)

| 키 | 어디 | 없어지면 | 서버 밖 보관 |
|---|---|---|---|
| `AUTH_SECRET_KEY` | anotar 서버 `.env` | 백업을 복원해도 로그인 불가 | **필수** |
| `HIVE_API_KEY` | anotar 서버 `.env` | 다시 발급 | 선택 |
| `SERVICE_TELEGRAM_BOT_TOKEN` | anotar 서버 `.env` | 다시 발급 | 선택 |
| `GOOGLE_MAPS_DEMO_KEY`, `GEOAPIFY_API_KEY` | anotar `.env` | 다시 발급 | 선택 |
| `RESEND_API_KEY` | harukan 서버 `.env`, 로컬 `.env` | 다시 발급 | 선택 |
| rclone Drive 토큰, crypt 비밀번호 | 서버 root 전용 파일 (계획) | 토큰은 다시 로그인. **비밀번호는 잃으면 Drive 백업을 못 엶** | 비밀번호 **필수** |
| 서버 접속 정보 | 로컬 `.env.oracle-server` | 서버 접속 불가 | 필수 |

## 정할 것

1. **로컬 개발의 기본 로그인.** 지금 로컬 `.env`가 로그인을 켜 두어서 로컬 계정의 비밀번호와 TOTP가 있어야 한다. 기능 확인이 주 목적이면 로컬 `.env`에 `AUTH_MODE=disabled`를 두고, 로그인 화면은 `npm run qa` 안의 로그인 검사에 맡기는 쪽을 추천한다.
2. **호스팅 개발 포트.** 개발 기본값 8792가 Docker 공유 스택과 겹친다. 개발 기본값을 8793으로 바꿀지.
3. **Docker 개인 스택을 평소에 띄워 둘지.** 지금 띄워진 이미지는 온라인 전용 전환 전 버전이다. `infra/`를 바꿀 때만 띄우는 쪽을 추천한다.
4. **위키 업로드(⑤)와 Drive 백업 설정을 어디에 둘지.** 위키는 정했다(2026-10-20): 서버 `leneu-memory-sync.timer`가 memory-data를 읽기 전용 deploy key로 pull해 만든다(`apps/anotar/docs/ORACLE_OPERATIONS.md` 위키 절). Drive 백업은 같은 방식(서버 systemd timer + root 전용 설정 파일)으로 두고 키 이름만 이 문서에 추가한다.
5. **운영에서 `AUTH_MODE=disabled`를 막을지.** 지금은 서버 `.env`에 실수로 넣으면 개인 API와 위키가 열린다. 쿠키 설정처럼 production에서는 거부하는 쪽을 추천한다. 그러려면 운영 이미지로 로그인 없이 도는 `qa-docker-share`에 검사 전용 예외를 먼저 만들어야 한다.
