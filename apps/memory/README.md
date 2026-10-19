# memory

AI 세션 기록(Claude Code·Codex·opencode)과 위키를 모아 anotar `/wiki` 화면에 데이터를 주는 도구. Python 표준 라이브러리만 쓴다.

데이터 repo 루트에서 실행한다 (`MEMORY_DATA` 환경변수로 바꿀 수 있음).

```sh
cd data/memory          # anotar repo 루트 기준
M=../../apps/memory
python3 $M/import_sessions.py   # 이 Mac의 세션 기록 → raw/sessions/
python3 $M/build.py             # wiki/ + sessions/ → site/data.json
python3 $M/test_build.py        # frontmatter 파서 확인
$M/daily.sh codex gpt-6.1-sol   # 가져오기 + 에이전트 요약 + 빌드 (+ push)
```

로컬에서 화면으로 보려면 `build.py` 뒤에 `apps/anotar`에서 `npm run dev`(또는 `dev:oracle`)를 띄우고 `/wiki`를 연다. 개발 서버가 이 repo의 `site/data.json`을 운영과 같은 경로(`/memory/data.json`)로 준다. 빌드를 다시 하면 새로고침만 하면 된다.

| 파일 | 역할 |
|---|---|
| `build.py` | frontmatter 검사 + site/data.json 생성 (화면은 anotar `apps/anotar/src/wiki/`) |
| `import_sessions.py` | ~/.claude, ~/.codex, opencode DB에서 대화만 추려 덤프 |
| `server.py` | `/memory/data.json` 제공, `/memory/`는 `/wiki`로 302 (`MEMORY_HOST`/`MEMORY_PORT`, 기본 127.0.0.1:8788). 인증은 앞단 Caddy가 맡는다. `test_server.py`로 확인 |
| `daily.sh` | 에이전트(claude/codex/opencode)와 모델을 골라 sessions 절차 실행 |
