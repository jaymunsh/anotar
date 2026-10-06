# Oracle 실운영 연결

2026-10-06 KST 기준. 비밀정보와 개인 자료는 GitHub에 포함하지 않는다.

## 주소와 요청 경로

| 주소 | 역할 | Oracle loopback |
| --- | --- | --- |
| `https://leneu.store` | 앱과 개인 API, 비밀번호 + TOTP 로그인 | `127.0.0.1:8787` |
| `https://share.leneu.store` | 명시적으로 공유한 문서와 공유 댓글 | `127.0.0.1:8790` |
| `https://host.leneu.store` | 독립 HTML/CSS/JS 사이트 | `127.0.0.1:8792` |

Cloudflare의 `anotar-oracle` 터널 → 해당 loopback 포트 → Docker Compose 서비스 순서다. 터널은 서버에서 바깥으로 연결하며 앱 포트를 인터넷에 직접 열지 않는다. Vercel은 현재 경로에 사용하지 않는다.

`anotar-tunnel.service`는 systemd credential로 토큰을 읽는다. 토큰 원본은 root만 읽는 파일이며 저장소·이미지에 넣지 않는다.

## 데이터와 배포

- 공개 소스: `https://github.com/jaymunsh/anotar`.
- `main` 변경 → GitHub Actions Node 24 의존성 설치 → 프런트 빌드 → 테스트. Oracle의 `anotar-deploy.timer`가 약 2분 간격으로 성공한 해당 workflow를 조회하고 배포한다.
- 공개 저장소 조회에는 GitHub 비밀키가 필요 없다. SSH는 본인 접속 IP 제한을 유지한다. GitHub 실행 서버에서 Oracle로 들어오는 SSH 연결이나 자체 Actions runner는 사용하지 않는다.
- root 소유 배포 스크립트는 고정 저장소의 최신 `main` SHA만 허용한다. 다른 브랜치·fork·실패한 검증 결과는 배포하지 않는다.
- `/srv/leneu/source`: root 소유 소스 체크아웃. `/srv/leneu/releases/<commit>`: 릴리스. `/srv/leneu/current`: 정상 릴리스 링크.
- `/srv/leneu/app/.env`: 운영 비밀정보. 릴리스에서 링크로 사용하며 GitHub에는 없다.
- `/srv/leneu/data-live`: SQLite·첨부·인증 원본. 페이지는 Markdown 파일 묶음이 아니라 SQLite 안의 블록 JSON과 메타데이터로 저장한다. Markdown은 가져오기·내보내기 형식이다.
- `/srv/leneu/backups`: SQLite 온라인 스냅샷과 첨부 백업. 배포 전 생성·검증한다. 같은 VM의 백업이므로 로컬 외부 사본도 보관한다.
- `/srv/leneu/sites`: 사이트 원본과 registry. SQLite 백업과 별도로 보관한다. 샘플 주소는 `https://host.leneu.store/mathematics/`.
- 릴리스 교체 전에 영구 bind 경로와 공개 읽기 전용 마운트를 검증한다. health 실패 시 이전 이미지·릴리스로 되돌린다.
- 빌드·백업에는 별도 시간 제한을 두어 서비스 교체·롤백 시간을 남긴다. 같은 커밋은 간격을 늘려 최대 세 번만 시도한다. 이후에는 새 검증 커밋 또는 관리자의 원인 해결을 기다린다.
- 공유 컨테이너의 `/data`와 호스팅 컨테이너의 `/sites`는 읽기 전용이다. 공개 서비스는 개인 API를 제공하지 않는다. 공유 댓글은 별도 IPC broker를 이용한다.

## AI 실행 상태

Oracle 이미지에는 OpenCode CLI와 Devin CLI가 설치되어 있다. Hive 키는 개인 서비스에만 주입한다. 사이트 설정에서 실행기와 모델을 선택하며 자동 유료 fallback은 없다.

초기 도구 `deny` 설정은 무료 제공자 403을 반환했다. 2026-10-06 호환 수정은 OpenCode 1.18.34의 전역/agent `ask`와 비대화형 자동 거절을 사용한다. 자동 승인 옵션은 전달하지 않으며 CLI 버전을 요청 전에 검증한다. Oracle ARM64의 `opencode/big-pickle` 합성 응답(보고 비용 0), 실제 파일 읽기·셸 실행 거절을 확인했다. 다른 무료 모델의 정상 응답까지 확인한 것은 아니다. Hive는 사용자가 명시적으로 선택할 수 있고 자동 유료 fallback은 없다. Devin은 서버 계정 로그인 연결이 추가로 필요하다.

요청별 CLI 실행 폴더는 임시 디렉터리에 만들고 성공·실패·취소 뒤 삭제한다. Oracle 컨테이너의 `/tmp`는 tmpfs다. 외부 제공자가 보관하는 기록까지 삭제하는 기능은 아니다.

2026-10-06 키워드 연결: OpenCode의 검색 단계에만 `websearch`를 자동 허용하고 요약과 나머지 도구는 자동 거절한다. Exa의 실제 검색 관측 URL을 기존 서버 수집기로 넘기고 주제·추가 검색 조건을 유지한다. Oracle ARM64의 무료 Muse Spark에서 합성 SQLite 주제의 검색·공개 본문 수집·요약·임시 DB 결과 저장, 확인한 출처 3개·원본 보존·남은 임시 기록 0개를 확인했다. 모든 무료 모델을 검증한 것은 아니다. 자동 Hive/유료 fallback은 없다.

## 감시와 비용 경계

- 서비스 감시 5분: CPU 90% 이상 연속 세 표본, 메모리 90% 이상, 디스크 여유 10GiB 미만, 세 서비스 health 실패.
- 배포 조회가 연속 세 번 실패하거나 검증된 릴리스 배포가 실패하면 서비스 방에 알린다. 같은 장애를 반복 통보하지 않고 복구 때 한 번 알린다.
- OCI 감시 30분: 비용·인스턴스·디스크·볼륨 백업 구성 확인. 정상 정기 메시지와 같은 경고의 시간별 재전송은 비활성화했다. 최초 이상·변화·복구 때만 알린다.
- 확인된 양수 비용 또는 설정한 무료 자원 경계 위반이면 고정 VM에 OCI STOP을 요청한다. 단순 CPU 이상이나 조회 불확실성만으로는 정지하지 않는다.
- 현재 A1 2 OCPU / RAM 12GB, 부트 디스크 100GB·Balanced 10 VPU, 볼륨 백업 0개. 계정의 전체 디스크 200GB·백업 5개 경계를 감시한다.
- OCI 비용 집계 지연, 알림 장애, 정지 후 남은 자원 비용 때문에 추가 요금 0원을 보장하는 장치는 아니다. 외부 AI 사용료는 별도다.

## 확인한 범위

HTTPS 앱 HTML 200, 초기화된 인증 상태, 미로그인 개인 API 401, 공개 health 200, 공개 개인 API 404, 수학 샘플 HTML 200을 확인했다. 실제 사용자의 비밀번호·OTP 입력과 기기 신뢰 로그인은 사용자가 브라우저에서 확인한다.

전체 아키텍처 그림은 이 경로와 `TECH_ARCHITECTURE.md`의 파일·모듈 지도를 바탕으로 작성할 수 있다. 향후 계획과 실제 연결을 구분한다.
