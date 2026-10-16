# infra

서버 구성 파일. 앱 코드는 `apps/`에 있다.

| 경로 | 무엇 |
|---|---|
| `edge/Caddyfile` | `my.` 앞단. `/` → anotar, `/memory/*` → 로그인 확인(`/api/auth/check`) 후 memory, `/internal/*` 404, `personal.` → `my.` 301 |
| `personal/compose.yaml` | 개인 스택: anotar + memory + caddy. caddy만 `127.0.0.1:8780`에 열린다 |

share·host·planner는 아직 기존 구성(`apps/anotar/compose.yaml`, `apps/planner/compose.oracle.yaml`)이고 Cloudflare tunnel이 각 포트로 직접 보낸다.

## 로컬 실행

```sh
cd infra/personal
cp .env.example .env            # AUTH_SECRET_KEY=$(openssl rand -hex 32) 채우기
(cd ../../data/memory && python3 ../../apps/memory/build.py)   # memory 화면 빌드
docker compose up -d --build --wait
docker compose exec anotar node scripts/seed-examples.mjs /data # 예시 문서 (선택)
docker compose exec -it anotar node scripts/auth-setup.mjs      # 계정 만들기 (대화형)
open http://my.localhost:8780
```

- Chrome은 `*.localhost`를 보안 컨텍스트로 봐서 HTTP에서도 `__Host-` Secure 쿠키가 동작한다. curl은 저장하지 않으니 `-H 'Cookie: ...'`로 직접 넘긴다
- anotar 앱의 **위키**(`/wiki`)는 `/memory/data.json`을 읽는다. 위키 내용을 바꾸면 `build.py`만 다시 실행하면 된다. `apps/memory/server.py`를 고쳤으면 `docker compose restart memory`
- 데이터는 `infra/personal/.local/` (git 제외). 지우면 새로 시작
- 공유 댓글 소켓은 named volume에 둔다. macOS bind mount에서는 Unix 소켓이 `ENOTSUP`로 실패한다
