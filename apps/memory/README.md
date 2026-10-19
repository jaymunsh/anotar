# memory

AI 작업 기록(Claude Code·Codex·opencode)을 모아 요약하고, 주간 회고와 위키로 정리해 anotar `/wiki` 화면에 보여 주는 도구. Python 표준 라이브러리만 쓴다. 이 문서는 anotar 위키의 **구조** 탭에도 그대로 보인다.

## 한눈에

```
이 Mac의 AI 대화 기록 (~/.claude, ~/.codex, opencode DB)
  │ ① import_sessions.py         대화만 추려 덤프
  ▼
raw/sessions/*.md                 원본 덤프 (git 제외, 이 Mac에만)
  │ ② summarize.py sessions      덤프 하나에 AI 한 번 (무료 모델)
  ▼
sessions/*.md                     세션 요약 = 'AI 기록' (git)
  │ ③ summarize.py weekly        한 주에 AI 한 번, 요약만 읽음
  ▼
digests/<월요일>.md                주간 회고 (git)
  │ ④ (사람이 고를 때) ingest     요약의 '위키 후보'를 주제 페이지로
  ▼
wiki/*.md                         위키 주제 페이지 (git)
  │ ⑤ build.py                   위 셋 + projects.json → 한 파일
  ▼
site/data.json                    anotar /wiki 화면이 읽는 유일한 파일
  │ ⑥ (아직 없음) SSH로 서버에 올림
  ▼
운영 anotar /wiki
```

- ①~⑤는 `daily.sh opencode` 한 번으로 돈다(끝에 데이터 repo commit + push). 지금은 손으로 실행한다.
- AI를 부르는 곳은 ②③④뿐이고 모두 이 Mac에서 나간다. 서버는 다 만든 `data.json`을 보여 주기만 한다.
- 데이터는 비공개 repo `memory-data`(로컬 `data/memory/`)에 있고, 코드는 이 폴더에 있다.

## 단계별

| 단계 | 입력 → 출력 | 다시 하는 기준 | 실패하면 |
|---|---|---|---|
| ① 가져오기 | 각 도구의 대화 기록 → `raw/sessions/<날짜>-<도구>-<id>.md` | 원본이 바뀐 세션만 다시 씀. 빈 세션은 건너뜀 | — |
| ② 세션 요약 | 덤프 1개 → `sessions/<같은 이름>.md` | 요약이 없거나 덤프가 더 새것 | 5분 넘으면 건너뛰고 다음 실행 때 다시 |
| ③ 주간 회고 | 그 주 세션 요약들 → `digests/<월요일>.md` | 회고가 없거나 그 주 요약이 더 새것 | 같음 |
| ④ 위키 정리 | 세션 요약 + 덤프 → `wiki/<주제>.md` | 사람이 시킬 때만 (`ingest`) | — |
| ⑤ 빌드 | wiki·sessions·digests·projects.json → `site/data.json` | 매번 전체 | frontmatter 오류면 파일 이름을 대고 멈춤 |

②③이 따르는 형식과 규칙은 데이터 repo의 `AGENTS.md`에 있다(구조 탭 아래쪽). 요약 품질을 바꾸려면 그 문서를 고친다.

### ② 요약이 이렇게 도는 이유

- 에이전트 한 번에 전부 맡기면 무료 모델은 맥락이 넘쳐 멈춘다. 그래서 **덤프 하나에 한 번씩** 부른다.
- 120KB가 넘는 덤프는 앞뒤 60KB씩만 남긴 사본(`raw/sessions/.cut/`)을 읽힌다. 요약 본문에 "긴 세션이라 앞뒤만 읽음"이 남는다.
- `opencode run`은 stdin이 열려 있으면 입력을 기다리며 멈춘다. 스크립트는 stdin을 닫고 부른다.
- opencode는 repo 밖 경로를 자동 거부한다. 그래서 잘라 낸 사본도 repo 안에 둔다.

## 설정

| 무엇 | 어디 | 예 |
|---|---|---|
| 숨길 프로젝트, 합칠 이름 | 데이터 repo `projects.json` | `{"hide": ["test*"], "alias": {"leneu-planner": "harukan"}}` |
| 요약 모델 | `MEMORY_MODEL` 또는 `daily.sh opencode <모델>` | 기본 `opencode/deepseek-v4.1-flash-free` |
| 데이터 위치 | `MEMORY_DATA` | 기본은 현재 폴더 |

- `hide`는 glob이다. 숨겨도 요약 파일은 그대로 있고 화면과 회고에서만 빠진다.
- `alias`는 요약의 `project` 값을 화면에서 바꿔 묶는다. 요약 파일은 고치지 않는다.

## 명령

```sh
cd data/memory                                  # anotar repo 루트 기준
M=../../apps/memory
$M/daily.sh opencode                            # ①②③⑤ + commit + push (무료 모델)
python3 $M/import_sessions.py                   # ①만
python3 $M/summarize.py sessions 5              # ② 오래된 것부터 5개만 (+⑤)
python3 $M/summarize.py weekly 2026-09-21       # ③ 그 주만 (+⑤)
python3 $M/build.py                             # ⑤만
python3 $M/test_build.py                        # 파서·projects.json 확인
```

로컬 화면: `apps/anotar`에서 `npm run dev` → `http://127.0.0.1:5173/wiki`. 개발 서버가 `data/memory/site/data.json`을 운영과 같은 경로(`/memory/data.json`)로 준다. 빌드를 다시 하면 새로고침만 하면 된다.

## 무엇을 고치려면 어디를

| 바꾸고 싶은 것 | 고칠 곳 |
|---|---|
| 세션 요약·주간 회고의 형식과 내용 | 데이터 repo `AGENTS.md` (sessions, weekly 절) |
| 숨길 프로젝트, 합칠 이름 | 데이터 repo `projects.json` |
| 요약 방식(나누는 단위, 시간 제한, 자르는 길이) | `summarize.py` |
| 가져올 도구, 덤프 형식 | `import_sessions.py` |
| `data.json`에 들어가는 것 | `build.py` |
| 화면 | `apps/anotar/src/wiki/` (`model.ts`는 계산, `WikiWorkspace.tsx`는 화면) |
| 운영에서 주는 방식 | `apps/anotar/server/memoryData.mjs` |

## 파일

| 파일 | 역할 |
|---|---|
| `import_sessions.py` | ~/.claude, ~/.codex, opencode DB에서 대화만 추려 덤프 |
| `summarize.py` | ② 세션 요약, ③ 주간 회고. opencode CLI를 파일·주마다 부름 |
| `build.py` | frontmatter 검사, projects.json 적용, `site/data.json` 생성(구조 탭 자료 포함) |
| `daily.sh` | 하루 한 번 돌릴 묶음. opencode는 summarize.py, claude·codex는 에이전트 한 번에 |
| `server.py` | `infra/personal` Docker 스택용 `/memory/data.json` 서버. 운영과 `npm run dev`에서는 쓰지 않음 |
| `GUIDE.md` | 쓰는 사람용 안내. anotar 위키 **가이드** 탭에 그대로 보인다 |
| `test_build.py`, `test_server.py` | 확인용 |

## 아직 없는 것

- ⑥ 운영 서버로 올리기, 매일 자동 실행(Mac 예약)
- anotar 서버의 AI 요청 기록은 위키에 들어가지 않는다
