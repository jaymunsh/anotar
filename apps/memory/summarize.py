"""opencode CLI로 세션 요약과 주간 회고를 만든다. 데이터 repo 루트에서 실행한다.

  python3 summarize.py sessions [개수]   raw/sessions 덤프를 하나씩 요약 (오래된 것부터)
  python3 summarize.py weekly [월요일]    세션이 바뀐 주의 회고를 digests/<월요일>.md로 (월요일을 주면 그 주만)

에이전트 한 번에 전부 맡기면 무료 모델은 맥락이 넘쳐 멈춘다. 그래서 파일(주)마다 한 번씩 부르고,
긴 덤프는 앞뒤만 잘라 읽힌다. 모델은 MEMORY_MODEL(기본 opencode/deepseek-v4.1-flash-free).
"""
import json, os, subprocess, sys, time
from datetime import date, timedelta

import build

DATA = build.DATA
MODEL = os.environ.get("MEMORY_MODEL") or "opencode/deepseek-v4.1-flash-free"
LABEL = "opencode/" + MODEL.split("/")[-1]
LIMIT = 120_000  # 이보다 긴 덤프는 혼자, 앞뒤 절반씩만 (무료 모델 맥락 한도)
BATCH_BYTES, BATCH_MAX = 60_000, 5  # 짧은 덤프는 합쳐 이만큼까지 한 번에 (AI 시작 비용을 나눔)
TIMEOUT = 300  # 한 번 부를 때 기본, 묶음은 파일마다 2분 더


def run(prompt, timeout=TIMEOUT):
    # stdin을 닫지 않으면 opencode run이 입력을 기다리며 멈춘다.
    try:
        subprocess.run(["opencode", "run", "-m", MODEL, prompt], cwd=DATA, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout)
    except subprocess.TimeoutExpired:
        pass


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
        run(f"AGENTS.md의 sessions 절차 3~5번과 세션 요약 형식을 따라 아래 덤프 {len(group)}개를 순서대로 하나씩 요약한다. "
            f"덤프마다 요약 파일 하나 (덤프 → 출력): {'; '.join(pairs)}.{note} 기존 파일이 있으면 promoted 보존. "
            f"summarized_by: {LABEL}. 다른 파일은 만들거나 고치지 않고, build.py·git은 실행하지 않는다. 확인 질문 없이 끝낸다.",
            TIMEOUT + 120 * (len(group) - 1))
        took = int(time.time() - start)
        for src in group:
            done += 1
            ok = not newer(src, DATA / "sessions" / src.name)
            failed += not ok
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
        run(f"AGENTS.md의 weekly 절차와 주간 회고 형식을 따라 {week} 주의 회고 하나만 쓴다. "
            f"읽을 요약: {names}. 프로젝트 이름은 이 목록을 따른다: "
            + ", ".join(sorted({s['project'] for s in items}))
            + f". 출력: digests/{week}.md. summarized_by: {LABEL}. 다른 파일은 고치지 않고, build.py·git은 실행하지 않는다. 확인 질문 없이 끝낸다.")
        ok = out.exists() and out.stat().st_mtime >= start
        failed += not ok
        print(f"{'ok  ' if ok else 'FAIL'} digests/{week}.md ({len(items)}개 세션) {int(time.time() - start)}s", flush=True)
    return failed


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "sessions":
        failed = sessions(int(sys.argv[2]) if len(sys.argv) > 2 else 10**6)
    elif mode == "weekly":
        failed = weekly(sys.argv[2] if len(sys.argv) > 2 else None)
    else:
        sys.exit(__doc__)
    build.main()
    sys.exit(1 if failed else 0)
