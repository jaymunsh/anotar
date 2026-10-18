# AGENTS.md — anotar 모노레포

이 repo는 **공개**(github.com/jaymunsh/anotar)다. 개인 데이터, 운영 DB 사본, 비밀값, 내부 보안 메모를 커밋하지 않는다.

## 구성

| 경로 | 무엇 | 규칙 |
|---|---|---|
| `apps/anotar/` | 개인 메모·페이지 앱 + 공개 공유 서버 + 정적 호스팅 서버 (Node) | `apps/anotar/AGENTS.md`를 먼저 읽는다 |
| `apps/memory/` | 기억 화면: 위키·AI 기록 뷰어, 빌드, 세션 가져오기, 실행 스크립트 (Python 표준 라이브러리) | 데이터는 이 repo에 없다 |
| `apps/harukan/` | Harukan(하루칸, 예전 이름 anotar 플래너·`apps/planner`): 제3자도 가입해 쓰는 하루 시간표 서비스, `leneu.store` (Node) | 개인 anotar와 DB·쿠키·배포를 공유하지 않는다. `apps/harukan/README.md` |

## 주소와 서비스 (운영, 2026-10-16 기준)

| 주소 | 서비스 | 누가 | 서버 |
|---|---|---|---|
| `leneu.store` (나중에 `harukan.leneu.store`) | Harukan | 누구나 (가입) | `/srv/anotar-planner`, 8794 |
| `personal.leneu.store` | anotar 개인 앱 | 본인만 | `/srv/leneu`, 8787 |
| `share.leneu.store` | anotar 공유 문서·댓글 | 링크 받은 사람 | 8790 |
| `host.leneu.store` | 정적 사이트 호스팅 | 누구나 | 8792 |

외부 요청은 Cloudflare tunnel이 주소별로 위 포트에 보낸다.

이 폴더 안에 있지만 **이 repo에는 안 들어가는** 별도 비공개 repo 2개 (`.gitignore`로 제외):

| 경로 | GitHub (비공개) | 무엇 |
|---|---|---|
| `data/memory/` | jaymunsh/memory-data | 위키·세션 요약. 데이터 규칙은 `data/memory/AGENTS.md` |
| `private/` | jaymunsh/anotar-private | 운영 기록, 비공개 문서, 설계 메모, 인계 문서 |

이 두 폴더에서 커밋·push할 때는 그 폴더 안에서 git을 쓴다 (각자 자기 `.git`이 있다).
인계 문서는 `private/docs/handoff/`에 있고, `.claude/session`이 그 폴더를 가리키는 링크다.

## 배포 주의

`main`에 push하면 GitHub Actions(`oracle.yml`)가 돌고 Oracle 서버가 그 커밋의 **anotar**를 자동 배포한다. `apps/harukan`만 바뀐 커밋은 `oracle.yml`을 건너뛰어 anotar를 재배포하지 않는다.
Harukan은 자동 배포가 없다. `harukan.yml`은 검사만 하고, 서버 반영은 `apps/harukan/docs/LAUNCH_RUNBOOK.md` 절차로 직접 한다.

`oracle-deploy.sh`는 `apps/anotar` 구조와 예전 루트 구조를 모두 처리하도록 고쳤지만 **서버의 `/usr/local/sbin/anotar-deploy`는 아직 옛 버전이다.** 서버 사본을 갱신하기 전에는 `main`에 merge하거나 push하지 않는다.
