"""wiki/*.md, sessions/*.md -> site/data.json (anotar /wiki 화면이 읽음).

데이터 폴더는 MEMORY_DATA 환경변수, 없으면 현재 폴더. 결과는 <데이터>/site/data.json.
"""
import json, os, pathlib, re, sys

DATA = pathlib.Path(os.environ.get("MEMORY_DATA", os.getcwd()))
WIKI_KEYS = ("title", "tldr", "tags", "updated")
SESSION_KEYS = ("title", "tldr", "tool", "project", "date")


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


def main():
    data = {"wiki": load("wiki", WIKI_KEYS, "updated"),
            "sessions": load("sessions", SESSION_KEYS, "date")}
    wiki_slugs = {p["slug"] for p in data["wiki"]}
    for s in data["sessions"]:
        if isinstance(s.get("promoted"), str):
            s["promoted"] = [s["promoted"]] if s["promoted"] else []
        for slug in s.get("promoted") or []:
            if slug not in wiki_slugs:
                sys.exit(f"sessions/{s['slug']}.md: promoted의 '{slug}' 위키 페이지가 없음")
    out = DATA / "site"
    out.mkdir(exist_ok=True)
    (out / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"site/data.json: wiki {len(data['wiki'])}, sessions {len(data['sessions'])}")


if __name__ == "__main__":
    main()
