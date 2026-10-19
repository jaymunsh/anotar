"""frontmatter 파서 확인: python3 test_build.py"""
import pathlib, tempfile
import build

t = pathlib.Path(tempfile.mkdtemp()) / "x.md"
t.write_text("---\ntitle: a\ntldr: b\ntool: codex\nproject: p\ndate: 2026-10-16\ntags: [x, y]\n"
             "next:\n  - 인증키 발급, 연결 테스트\n  - HTTPS 해결\npromoted: []\n---\nbody", encoding="utf-8")
m = build.parse(t, build.SESSION_KEYS)
assert m["tags"] == ["x", "y"], m["tags"]
assert m["next"] == ["인증키 발급, 연결 테스트", "HTTPS 해결"], m["next"]
assert m["promoted"] == [] and m["body"] == "body"
ss = [{"project": p} for p in ("test-qwen", "leneu-planner", "career")]
kept = build.tidy_projects(ss, {"hide": ["test-*"], "alias": {"leneu-planner": "harukan"}})
assert [s["project"] for s in kept] == ["harukan", "career"], kept
assert build.tidy_projects([{"project": "a"}], {}) == [{"project": "a"}]
print("ok")

# summarize.py: 짧은 덤프는 날짜순을 지키며 묶고, 긴 덤프는 혼자
import summarize
d = pathlib.Path(tempfile.mkdtemp())
files = []
for i, n in enumerate([1000, 1000, 200_000, 50_000, 20_000, 1000, 1000, 1000, 1000, 1000]):
    (d / f"{i:02}.md").write_bytes(b"x" * n)
    files.append(d / f"{i:02}.md")
groups = [[p.stem for p in g] for g in summarize.batches(files)]
assert groups == [["00", "01"], ["02"], ["03"], ["04", "05", "06", "07", "08"], ["09"]], groups
print("ok batches")

# import_sessions.py: summarize.py가 만든 opencode 세션은 가져오지 않는다
import import_sessions
assert import_sessions.is_own([("user", '"AGENTS.md의 sessions 절차 3~5번과 ...')])
assert import_sessions.is_own([("assistant", "x"), ("user", "AGENTS.md의 weekly 절차를 따라")])
assert not import_sessions.is_own([("user", "AGENTS.md 고쳐 줘")])
print("ok own sessions")
