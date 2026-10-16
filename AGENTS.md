# AGENTS.md — anotar 모노레포

이 repo는 **공개**(github.com/jaymunsh/anotar)다. 개인 데이터, 운영 DB 사본, 비밀값, 내부 보안 메모를 커밋하지 않는다.

## 구성

| 경로 | 무엇 | 규칙 |
|---|---|---|
| `apps/anotar/` | 개인 메모·페이지 앱 + 공개 공유 서버 + 정적 호스팅 서버 (Node) | `apps/anotar/AGENTS.md`를 먼저 읽는다 |
| `apps/memory/` | 기억 화면: 위키·AI 기록 뷰어, 빌드, 세션 가져오기, 실행 스크립트 (Python 표준 라이브러리) | 데이터는 이 repo에 없다 |

함께 쓰는 옆 폴더 (이 repo 밖):

- `../memory-data/` — 위키·세션 요약 데이터 (비공개 repo). 데이터 규칙은 그쪽 `AGENTS.md`.
- `../anotar-private/` — 운영 기록, 비공개 문서, 인계 문서 (비공개 repo).

## 배포 주의

`main`에 push하면 GitHub Actions(`oracle.yml`)가 돌고 Oracle 서버가 그 커밋을 자동 배포한다.
지금 배포 스크립트는 예전 루트 구조(`compose.yaml`이 repo 루트)를 가정한다. **`apps/` 구조에 맞게 배포 경로를 고치기 전에는 `main`에 merge하거나 push하지 않는다.**
