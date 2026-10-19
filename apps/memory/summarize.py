"""opencode CLI로 세션 요약과 주간 회고를 만든다. 데이터 repo 루트에서 실행한다.

  python3 summarize.py sessions [개수]   raw/sessions 덤프를 하나씩 요약 (오래된 것부터)
  python3 summarize.py weekly [월요일]    세션이 바뀐 주의 회고를 digests/<월요일>.md로 (월요일을 주면 그 주만)

에이전트 한 번에 전부 맡기면 무료 모델은 맥락이 넘쳐 멈춘다. 그래서 파일(주)마다 한 번씩 부르고,
긴 덤프는 앞뒤만 잘라 읽힌다.

모델은 MODELS 순서대로 쓴다. 시작할 때 답하는 첫 모델을 고르고, 도중에 그 모델이 답하지 않으면
다음 모델로 넘어가 같은 작업을 한 번 더 한다. MEMORY_MODELS(쉼표)로 순서를 바꾸고,
MEMORY_MODEL을 주면 그 모델을 맨 앞에 둔다. 실행마다 runs.jsonl에 한 줄 남긴다(위키 구조 탭).
"""
import json, os, subprocess, sys, time
from datetime import date, datetime, timedelta

import build

DATA = build.DATA
DEFAULT_MODELS = ["opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free",
                  "opencode/mimo-v2.6-flash-free", "opencode/space-bunny-free"]
MODELS = [m.strip() for m in (os.environ.get("MEMORY_MODELS") or ",".join(DEFAULT_MODELS)).split(",") if m.strip()]
if os.environ.get("MEMORY_MODEL"):
    MODELS = [os.environ["MEMORY_MODEL"]] + [m for m in MODELS if m != os.environ["MEMORY_MODEL"]]
LIMIT = 120_000  # 이보다 긴 덤프는 혼자, 앞뒤 절반씩만 (무료 모델 맥락 한도)
BATCH_BYTES, BATCH_MAX = 60_000, 5  # 짧은 덤프는 합쳐 이만큼까지 한 번에 (AI 시작 비용을 나눔)
TIMEOUT = 300  # 한 번 부를 때 기본, 묶음은 파일마다 2분 더


class NoModel(Exception):
    pass


current = None  # 지금 쓰는 모델
down = []  # 이번 실행에서 답하지 않은 모델
stats = {}  # 모델 → {"ok": n, "fail": n}


def label():
    return "opencode/" + current.split("/")[-1]


def answers(model):
    """무료 모델은 한도에 걸리면 답 없이 멈춘다. 파일마다 5분씩 버리기 전에 확인한다."""
    try:
        r = subprocess.run(["opencode", "run", "-m", model, "ok 한 단어로만 답해"], cwd=DATA, stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=90)
        return r.returncode == 0 and "ok" in r.stdout.lower()
    except subprocess.TimeoutExpired:
        return False


def pick():
    global current
    for model in MODELS:
        if model in down:
            continue
        if answers(model):
            current = model
            print(f"모델: {model}", flush=True)
            return
        down.append(model)
        print(f"모델 {model}: 90초 안에 답 없음, 다음 모델로", flush=True)
    raise NoModel("답하는 모델이 없음 (무료 한도·장애일 수 있음)")


def run(prompt, timeout=TIMEOUT):
    # stdin을 닫지 않으면 opencode run이 입력을 기다리며 멈춘다.
    try:
        subprocess.run(["opencode", "run", "-m", current, prompt], cwd=DATA, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout)
    except subprocess.TimeoutExpired:
        pass


def attempt(make_prompt, timeout, succeeded):
    """한 번 해 보고, 실패했는데 모델이 죽었으면 다음 모델로 한 번 더."""
    run(make_prompt(), timeout)
    if not succeeded() and not answers(current):
        down.append(current)
        print(f"모델 {current}: 도중에 답하지 않음, 다음 모델로", flush=True)
        pick()
        run(make_prompt(), timeout)


def count(ok):
    entry = stats.setdefault(current, {"ok": 0, "fail": 0})
    entry["ok" if ok else "fail"] += 1


def newer(src, out):
    return not out.exists() or src.stat().st_mtime > out.stat().st_mtime


def batches(todo):
    """날짜순을 지키며 짧은 덤프를 묶는다. 긴 덤프는 혼자."""
    group, size = [], 0
    for src in todo:
        n = src.stat().st_size
        if group and (n > LIMIT or size + n > BATCH_BYTES or len(group) == BATCH_MAX):
            yield group
            group, size = [], 0
        group.append(src)
        size += n
        if n > LIMIT:
            yield group
            group, size = [], 0
    if group:
        yield group


def sessions(limit):
    raw = DATA / "raw/sessions"
    todo = [p for p in sorted(raw.glob("*.md")) if newer(p, DATA / "sessions" / p.name)][:limit]
    failed = done = 0
    for group in batches(todo):
        pairs, note = [], ""
        for src in group:
            rel = f"raw/sessions/{src.name}"
            if src.stat().st_size > LIMIT:
                text = src.read_text(encoding="utf-8", errors="replace")
                cut = raw / ".cut" / src.name  # repo 안이어야 opencode가 읽는다. raw/sessions는 git 제외
                cut.parent.mkdir(exist_ok=True)
                cut.write_text(text[: LIMIT // 2] + "\n\n[... 중간 생략: 원본이 길어 앞뒤만 남김 ...]\n\n" + text[-LIMIT // 2:], encoding="utf-8")
                rel = f"raw/sessions/.cut/{src.name}"
                note = ' 덤프는 원본이 길어 앞뒤만 남긴 사본이다. 본문 "한 일" 첫 줄에 "긴 세션이라 앞뒤만 읽음"이라고 쓴다.'
            pairs.append(f"{rel} → sessions/{src.name}")
        start = time.time()
        attempt(lambda: f"AGENTS.md의 sessions 절차 3~5번과 세션 요약 형식을 따라 아래 덤프 {len(group)}개를 순서대로 하나씩 요약한다. "
                f"덤프마다 요약 파일 하나 (덤프 → 출력): {'; '.join(pairs)}.{note} 기존 파일이 있으면 promoted 보존. "
                f"summarized_by: {label()}. 다른 파일은 만들거나 고치지 않고, build.py·git은 실행하지 않는다. 확인 질문 없이 끝낸다.",
                TIMEOUT + 120 * (len(group) - 1),
                lambda: all(not newer(src, DATA / "sessions" / src.name) for src in group))
        took = int(time.time() - start)
        for src in group:
            done += 1
            ok = not newer(src, DATA / "sessions" / src.name)
            failed += not ok
            count(ok)
            print(f"[{done}/{len(todo)}] {'ok  ' if ok else 'FAIL'} {src.name} ({len(group)}개 묶음 {took}s)", flush=True)
    return failed


def monday(day):
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()


def weekly(only=None):
    config = DATA / "projects.json"
    config = json.loads(config.read_text(encoding="utf-8")) if config.exists() else {}
    weeks = {}
    for s in build.tidy_projects(build.load("sessions", build.SESSION_KEYS, "date"), config):
        if s["title"] != "(내용 없음)":
            weeks.setdefault(monday(s["date"]), []).append(s)
    (DATA / "digests").mkdir(exist_ok=True)
    failed = 0
    for week, items in sorted(weeks.items()):
        if only and week != only:
            continue
        out = DATA / "digests" / f"{week}.md"
        if out.exists() and all(not newer(DATA / "sessions" / f"{s['slug']}.md", out) for s in items):
            continue
        names = ", ".join(f"sessions/{s['slug']}.md" for s in items)
        start = time.time()
        done = lambda: out.exists() and out.stat().st_mtime >= start
        attempt(lambda: f"AGENTS.md의 weekly 절차와 주간 회고 형식을 따라 {week} 주의 회고 하나만 쓴다. "
                f"읽을 요약: {names}. 프로젝트 이름은 이 목록을 따른다: "
                + ", ".join(sorted({s['project'] for s in items}))
                + f". 출력: digests/{week}.md. summarized_by: {label()}. 다른 파일은 고치지 않고, build.py·git은 실행하지 않는다. 확인 질문 없이 끝낸다.",
                TIMEOUT, done)
        ok = done()
        failed += not ok
        count(ok)
        print(f"{'ok  ' if ok else 'FAIL'} digests/{week}.md ({len(items)}개 세션) {int(time.time() - start)}s", flush=True)
    return failed


def log_run(mode, started, stopped):
    """runs.jsonl: 실행마다 한 줄. build.py가 최근 것을 구조 탭에 넣는다."""
    entry = {"at": started.isoformat(timespec="seconds"), "mode": mode,
             "seconds": int((datetime.now() - started).total_seconds()),
             "models": stats, "down": down, "stopped": stopped}
    with open(DATA / "runs.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in ("sessions", "weekly"):
        sys.exit(__doc__)
    started, failed, stopped = datetime.now(), 0, None
    try:
        pick()
        if mode == "sessions":
            failed = sessions(int(sys.argv[2]) if len(sys.argv) > 2 else 10**6)
        else:
            failed = weekly(sys.argv[2] if len(sys.argv) > 2 else None)
    except NoModel as error:
        stopped = str(error)
        print(f"멈춤: {stopped}. 나중에 다시 실행해 주세요.", flush=True)
    log_run(mode, started, stopped)
    build.main()
    sys.exit(1 if failed or stopped else 0)
