"""로컬 AI 세션 기록 -> raw/sessions/*.md (대화만 추린 원본 덤프).

Claude Code, Codex, opencode를 읽는다. 이미 가져온 세션은 원본이 바뀐 경우에만 다시 쓴다(--force면 전부).
요약은 하지 않는다. 요약은 에이전트가 AGENTS.md의 sessions 절차로 한다.
시각은 KST. 끝에 sessions/*.md 요약의 date·started·ended를 덤프 값으로 맞춘다(--stamp면 이것만).
"""
import json, os, pathlib, re, sqlite3, sys
from datetime import datetime, timedelta, timezone

# 데이터 폴더: MEMORY_DATA 환경변수, 없으면 현재 폴더
DATA = pathlib.Path(os.environ.get("MEMORY_DATA", os.getcwd()))
OUT = DATA / "raw" / "sessions"
HOME = pathlib.Path.home()
# ponytail: 메시지당 글자 수를 잘라서 덤프 크기를 제한. 긴 코드 붙여넣기는 잘림.
MAX_USER, MAX_AI = 3000, 2000
KST = timezone(timedelta(hours=9))


def moment(value):
    """epoch 초, 또는 ISO 문자열(Z·오프셋이 있으면 그 시각, 없으면 Mac 현지 시각) → aware datetime (못 읽으면 None)."""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, KST)
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return t if t.tzinfo else t.astimezone()


def kst(value):
    """epoch 초, 또는 ISO 문자열(Z·오프셋이 있으면 그 시각, 없으면 Mac 현지 시각) → KST 'YYYY-MM-DDTHH:MM'."""
    t = moment(value)
    return t.astimezone(KST).strftime("%Y-%m-%dT%H:%M") if t else str(value)[:16]


def clip(text, n):
    text = text.strip()
    return text if len(text) <= n else text[:n] + " …(잘림)"


def is_noise(text):
    # 시스템이 끼워 넣은 메시지 (명령 캐비엇, 환경 정보, AGENTS.md 주입 등)
    t = text.lstrip()
    return not t or t.startswith(("<", "# AGENTS.md", "Caveat:"))


def claude_code():
    for f in (HOME / ".claude/projects").glob("*/*.jsonl"):
        title, cwd, started, last, turns, models = "", "", "", "", [], []
        for line in f.open(encoding="utf-8"):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("type") == "ai-title":
                title = d.get("aiTitle", "")
            if d.get("type") not in ("user", "assistant") or d.get("isMeta") or d.get("isSidechain"):
                continue
            cwd = cwd or d.get("cwd", "")
            started = started or d.get("timestamp", "")
            last = d.get("timestamp") or last
            model = d["message"].get("model")
            if model and not model.startswith("<") and model not in models:
                models.append(model)
            content = d["message"].get("content")
            if isinstance(content, str):
                texts = [content]
            else:
                texts = [c.get("text", "") for c in content or [] if c.get("type") == "text"]
            for t in texts:
                if not is_noise(t):
                    turns.append((d["type"], t))
        yield "claude-code", f.stem, title, cwd, started, last, turns, models, f.stat().st_mtime, f


def codex():
    for base in ("sessions", "archived_sessions"):
        for f in (HOME / ".codex" / base).rglob("*.jsonl"):
            cwd, started, last, turns, models = "", "", "", [], []
            for line in f.open(encoding="utf-8"):
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                p = d.get("payload") or {}
                if d.get("type") == "session_meta":
                    cwd, started, sid = p.get("cwd", ""), p.get("timestamp", ""), p.get("id", f.stem)
                elif d.get("type") == "turn_context":
                    if p.get("model") and p["model"] not in models:
                        models.append(p["model"])
                elif d.get("type") == "response_item" and p.get("type") == "message" and p.get("role") in ("user", "assistant"):
                    for c in p.get("content") or []:
                        t = c.get("text", "")
                        if c.get("type") in ("input_text", "output_text") and not is_noise(t):
                            turns.append((p["role"], t))
                            last = d.get("timestamp") or last
            yield "codex", f.stem.split("-")[-1] if "rollout" in f.stem else f.stem, "", cwd, started, last, turns, models, f.stat().st_mtime, f


def opencode():
    db = HOME / ".local/share/opencode/opencode.db"
    if not db.exists():
        return
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    sessions = con.execute(
        "select id, title, directory, time_created, time_updated, model from session where parent_id is null").fetchall()
    for sid, title, cwd, created, updated, model in sessions:
        try:
            models = [json.loads(model)["id"]] if model else []
        except (ValueError, KeyError, TypeError):
            models = [model]
        rows = con.execute(
            """select json_extract(m.data, '$.role'), p.data from message m join part p on p.message_id = m.id
               where m.session_id = ? and json_extract(p.data, '$.type') = 'text'
               order by m.time_created, p.id""", (sid,)).fetchall()
        turns = []
        for role, data in rows:
            part = json.loads(data)
            if not part.get("synthetic") and not is_noise(part.get("text", "")):
                turns.append((role, part["text"]))
        if title.startswith("New session - "):
            title = ""
        started = datetime.fromtimestamp(created / 1000).isoformat()
        yield "opencode", sid, title, cwd, started, updated / 1000, turns, models, updated / 1000, db


# summarize.py가 opencode를 부를 때 생기는 세션. 가져오면 요약 작업을 또 요약하게 된다.
OWN_PROMPTS = ("AGENTS.md의 sessions 절차", "AGENTS.md의 weekly 절차")


def is_own(turns):
    first = next((text for role, text in turns if role == "user"), "")
    return first.lstrip("\"' ").startswith(OWN_PROMPTS)


def stamp():
    """요약의 date·started·ended를 덤프 값으로. 모델이 옮겨 적지 않게 스크립트가 넣는다."""
    changed = 0
    for summary in (DATA / "sessions").glob("*.md"):
        dump = OUT / summary.name
        head = dump.read_text(encoding="utf-8")[:600] if dump.exists() else ""
        times = dict(re.findall(r"^(started|ended): (\S+)$", head, re.M))
        if "ended" not in times:  # 예전 형식(UTC, 끝 시각 없음) 덤프는 건너뜀
            continue
        text = summary.read_text(encoding="utf-8")
        new = re.sub(r"^(started|ended): .*\n", "", text, flags=re.M)
        new = re.sub(r"^date: .*$", f"date: {times['started'][:10]}\nstarted: {times['started']}\nended: {times['ended']}",
                     new, count=1, flags=re.M)
        if new != text:
            # Keep the summary's mtime so a continued session still shows up as newer than its summary.
            st = summary.stat()
            summary.write_text(new, encoding="utf-8")
            os.utime(summary, (st.st_atime, st.st_mtime))
            changed += 1
    print(f"sessions: 시각 맞춤 {changed}")


def main():
    if "--stamp" in sys.argv:
        return stamp()
    OUT.mkdir(parents=True, exist_ok=True)
    written = skipped = empty = own = 0
    for source in (claude_code, codex, opencode):
        for tool, sid, title, cwd, started, last, turns, models, mtime, src in source():
            if not any(role == "user" for role, _ in turns):
                empty += 1
                continue
            # opencode/codex in the data folder is always the wiki tooling itself (summaries, model probes, tests).
            if is_own(turns) or (tool in ("opencode", "codex") and cwd and pathlib.Path(cwd).resolve() == DATA.resolve()):
                own += 1
                continue
            date = started[:10] or datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")
            out = OUT / f"{date}-{tool}-{sid[-8:]}.md"
            if out.exists() and out.stat().st_mtime >= (moment(last) or moment(mtime)).timestamp() and "--force" not in sys.argv:
                skipped += 1
                continue
            lines = ["---", f"tool: {tool}", f"project: {cwd}", f"started: {kst(started)}", f"ended: {kst(last or mtime)}",
                     f"title: {title}", f"models: [{', '.join(models)}]", f"source: {src}", f"session_id: {sid}", "---", ""]
            for role, text in turns:
                lines += [f"### {'user' if role == 'user' else 'assistant'}", "",
                          clip(text, MAX_USER if role == "user" else MAX_AI), ""]
            out.write_text("\n".join(lines), encoding="utf-8")
            # The dump's mtime is the last message, not the source file's mtime (tools touch files without new
            # messages), so "dump newer than summary" means the conversation really continued.
            t = (moment(last) or moment(mtime)).timestamp()
            os.utime(out, (t, t))
            written += 1
    print(f"raw/sessions: 새로/갱신 {written}, 변경없음 {skipped}, 빈 세션 건너뜀 {empty}, 위키 요약 작업 건너뜀 {own}")
    stamp()


if __name__ == "__main__":
    sys.exit(main())
