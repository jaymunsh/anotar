# memory

AI 세션 기록(Claude Code·Codex·opencode)과 위키를 한 화면에서 보는 도구. Python 표준 라이브러리만 쓴다.

데이터 repo 루트에서 실행한다 (`MEMORY_DATA` 환경변수로 바꿀 수 있음).

```sh
cd data/memory          # anotar repo 루트 기준
M=../../apps/memory
python3 $M/import_sessions.py   # 이 Mac의 세션 기록 → raw/sessions/
python3 $M/build.py             # wiki/ + sessions/ → site/index.html
python3 $M/test_build.py        # frontmatter 파서 확인
$M/daily.sh codex gpt-6.1-sol   # 가져오기 + 에이전트 요약 + 빌드 (+ push)
```

| 파일 | 역할 |
|---|---|
| `viewer.html` | 화면 템플릿. build.py가 데이터를 넣어 한 파일로 만든다 |
| `build.py` | frontmatter 검사 + site/index.html 생성 |
| `import_sessions.py` | ~/.claude, ~/.codex, opencode DB에서 대화만 추려 덤프 |
| `server.py` | `/memory/`에서 `site/index.html` 제공 (`MEMORY_HOST`/`MEMORY_PORT`, 기본 127.0.0.1:8788). 인증은 앞단 Caddy가 맡는다. `test_server.py`로 확인 |
| `daily.sh` | 에이전트(claude/codex/opencode)와 모델을 골라 sessions 절차 실행 |
