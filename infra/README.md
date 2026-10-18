# infra

서버 구성 파일. 앱 코드는 `apps/`에 있다.

| 경로 | 무엇 |
|---|---|
| `edge/Caddyfile` | `my.` 앞단. `/` → anotar, `/memory/*` → 로그인 확인(`/api/auth/check`) 후 memory, `/internal/*` 404, `personal.` → `my.` 301 |
| `personal/compose.yaml` | 개인 스택: anotar + memory + caddy. caddy만 `127.0.0.1:8780`에 열린다 |
| `public/compose.yaml` | 공유 스택: share(공유 문서·댓글, 8790) + sites(정적 호스팅, 8792). 개인이 내보낸 폴더만 읽는다 |

Harukan(옛 planner)은 아직 기존 구성(`apps/harukan/compose.oracle.yaml`)이고 Cloudflare tunnel이 각 포트로 직접 보낸다.

## 개인 ↔ 공유 경계

공유 스택은 개인 DB·첨부 원본·키를 마운트하지 않는다. 개인 앱이 `PUBLIC_DIR`(기본 `public/.local`)에 쓰고, 공유 스택은 읽기만 한다.

| 폴더 | 쓰는 쪽 | 내용 |
|---|---|---|
| `shares/<sha256(토큰)>.json` | 개인 (`server/shareSnapshots.mjs`) | 공유 중인 페이지의 제목·본문·첨부 목록·공개 일정 할 일·만료·댓글 허용 |
| `shares/assets/<assetId>` | 개인 | 그 페이지가 참조하는 첨부만 복사 |
| `sites/` | 개인 (호스팅 게시) | 정적 사이트 |

- 스냅샷은 공유를 만들거나 바꾸거나 끊을 때 바로, 그리고 2초마다 다시 맞춘다. 페이지를 고치면 공유 링크에 1~2초 안에 반영되고, 공유를 끊거나 페이지를 휴지통에 넣으면 파일이 지워진다. 만료는 공유 서버도 직접 확인한다
- 손님 댓글은 개인 앱의 댓글 소켓(`anotar-comment-ipc` 볼륨)으로 간다. 소켓이 받는 요청은 유효한 공유 토큰의 댓글 목록·작성·답글뿐이다
- `PUBLIC_SHARES_DIR`가 없으면 `<DATA_DIR>/public-shares`를 쓴다. 그래서 `/data`를 통째로 읽기 전용으로 붙이던 예전 `apps/anotar/compose*.yaml`도 그대로 동작한다(서버를 새 구성으로 옮기기 전까지)

## 로컬 실행

```sh
cd infra/personal
cp .env.example .env            # AUTH_SECRET_KEY=$(openssl rand -hex 32) 채우기
(cd ../../data/memory && python3 ../../apps/memory/build.py)   # memory 화면 빌드
docker compose up -d --build --wait
docker compose exec anotar node scripts/seed-examples.mjs /data # 예시 문서 (선택)
docker compose exec -it anotar node scripts/auth-setup.mjs      # 계정 만들기 (대화형)
open http://my.localhost:8780
(cd ../public && docker compose up -d --build)                 # 공유 링크 http://127.0.0.1:8790/s/...
```

- Chrome은 `*.localhost`를 보안 컨텍스트로 봐서 HTTP에서도 `__Host-` Secure 쿠키가 동작한다. curl은 저장하지 않으니 `-H 'Cookie: ...'`로 직접 넘긴다
- anotar 앱의 **위키**(`/wiki`)는 `/memory/data.json`을 읽는다. 위키 내용을 바꾸면 `build.py`만 다시 실행하면 된다. `apps/memory/server.py`를 고쳤으면 `docker compose restart memory`
- 데이터는 `infra/personal/.local/` (git 제외). 지우면 새로 시작
- 공유 댓글 소켓은 named volume에 둔다. macOS bind mount에서는 Unix 소켓이 `ENOTSUP`로 실패한다
