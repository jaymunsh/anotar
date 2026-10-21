"""wiki/*.md, sessions/*.md(Mac), anotar/*.md(서버 AI 요청) -> site/data.json (anotar /wiki 화면이 읽음).

데이터 폴더는 MEMORY_DATA 환경변수, 없으면 현재 폴더. 결과는 <데이터>/site/data.json.
<데이터>/projects.json(선택)으로 세션의 project를 정리한다:
  {"hide": ["test-*"], "alias": {"leneu-planner": "harukan"}}
hide(glob)에 걸리는 프로젝트의 세션은 화면에서 빼고, alias는 이름을 합친다. 요약 파일은 그대로 둔다.
"""
import fnmatch, json, os, pathlib, re, sys
from datetime import datetime, timezone

DATA = pathlib.Path(os.environ.get("MEMORY_DATA", os.getcwd()))
CODE = pathlib.Path(__file__).resolve().parent
WIKI_KEYS = ("title", "tldr", "tags", "updated")
SESSION_KEYS = ("title", "tldr", "tool", "project", "date")
DIGEST_KEYS = ("title", "tldr", "week")
ANOTAR_KEYS = ("title", "tldr", "template", "date")


def parse(path, required):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n?(.*)", text, re.S)
    if not m:
        sys.exit(f"{path}: frontmatter 없음")
    meta, key = {}, None
    for line in m.group(1).splitlines():
        # 여러 줄 목록:  key:\n  - 항목  (항목 안에 쉼표가 있어도 됨)
        if line.lstrip().startswith("- ") and key:
            if not isinstance(meta[key], list):
                meta[key] = []
            meta[key].append(line.lstrip()[2:].strip())
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if val.startswith("[") and val.endswith("]"):
            val = [v.strip() for v in val[1:-1].split(",") if v.strip()]
        meta[key] = val
    missing = [k for k in required if not meta.get(k)]
    if missing:
        sys.exit(f"{path}: frontmatter에 {', '.join(missing)} 없음")
    return {"slug": path.stem, **meta, "body": m.group(2)}


def load(folder, required, sort_key):
    items = [parse(p, required) for p in (DATA / folder).glob("*.md")]
    return sorted(items, key=lambda p: p[sort_key], reverse=True)


def tidy_projects(sessions, config):
    alias, hide = config.get("alias", {}), config.get("hide", [])
    kept = []
    for s in sessions:
        s["project"] = alias.get(s["project"], s["project"])
        if not any(fnmatch.fnmatch(s["project"], pattern) for pattern in hide):
            kept.append(s)
    return kept


def system(config, shown):
    """구조·가이드 탭 자료: README, GUIDE, 데이터 repo 규칙, 설정, 단계별 개수."""
    read = lambda p: p.read_text(encoding="utf-8") if p.exists() else ""
    raw = list((DATA / "raw/sessions").glob("*.md"))
    pending = sum(1 for p in raw if not (DATA / "sessions" / p.name).exists()
                  or p.stat().st_mtime > (DATA / "sessions" / p.name).stat().st_mtime)
    summarized = len(list((DATA / "sessions").glob("*.md")))
    runs_file = DATA / "runs.jsonl"
    runs = [json.loads(line) for line in read(runs_file).splitlines() if line.strip()][-15:][::-1]
    by_model = {}
    for p in (DATA / "sessions").glob("*.md"):
        m = re.search(r"^summarized_by:\s*(.+)$", p.read_text(encoding="utf-8"), re.M)
        key = m.group(1).strip() if m else "(모름)"
        by_model[key] = by_model.get(key, 0) + 1
    return {"runs": runs, "byModel": sorted(by_model.items(), key=lambda kv: -kv[1]),"readme": read(CODE / "README.md"), "guide": read(CODE / "GUIDE.md"), "agents": read(DATA / "AGENTS.md"), "projects": config,
            "counts": {"raw": len(raw), "pending": pending, "summarized": summarized,
                       "shown": shown, "hidden": summarized - shown}}



def main():
    config_path = DATA / "projects.json"
    config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
    data = {"wiki": load("wiki", WIKI_KEYS, "updated"),
            "sessions": tidy_projects(load("sessions", SESSION_KEYS, "date"), config),
            "anotar": load("anotar", ANOTAR_KEYS, "date"),
            "digests": load("digests", DIGEST_KEYS, "week"),
            "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    data["system"] = system(config, len(data["sessions"]))
    wiki_slugs = {p["slug"] for p in data["wiki"]}
    for folder in ("sessions", "anotar"):
        for s in data[folder]:
            if isinstance(s.get("promoted"), str):
                s["promoted"] = [s["promoted"]] if s["promoted"] else []
            for slug in s.get("promoted") or []:
                if slug not in wiki_slugs:
                    sys.exit(f"{folder}/{s['slug']}.md: promoted의 '{slug}' 위키 페이지가 없음")
    out = DATA / "site"
    out.mkdir(exist_ok=True)
    (out / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"site/data.json: wiki {len(data['wiki'])}, sessions {len(data['sessions'])}, anotar {len(data['anotar'])}, digests {len(data['digests'])}")


if __name__ == "__main__":
    main()
