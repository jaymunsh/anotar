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

# import_sessions: KST 변환, 요약의 date·started·ended를 덤프 값으로
d = pathlib.Path(tempfile.mkdtemp())
import import_sessions as imp
imp.DATA, imp.OUT = d, d / "raw/sessions"
assert imp.kst("2026-10-19T18:02:11.123Z") == "2026-10-20T03:02"
(d / "raw/sessions").mkdir(parents=True); (d / "sessions").mkdir()
(d / "raw/sessions/a.md").write_text("---\nstarted: 2026-10-20T03:02\nended: 2026-10-20T05:40\n---\n", encoding="utf-8")
(d / "raw/sessions/b.md").write_text("---\nstarted: 2026-10-19T18:02\n---\n", encoding="utf-8")  # 예전 형식
for n in ("a", "b"):
    (d / f"sessions/{n}.md").write_text("---\ntitle: t\ndate: 2026-10-19\ntags: []\n---\nbody", encoding="utf-8")
imp.stamp(); imp.stamp()  # 두 번 돌려도 같다
a = (d / "sessions/a.md").read_text(encoding="utf-8")
assert "date: 2026-10-20\nstarted: 2026-10-20T03:02\nended: 2026-10-20T05:40\ntags" in a and a.count("started:") == 1, a
assert "started" not in (d / "sessions/b.md").read_text(encoding="utf-8")
print("ok import")

# import_anotar: 끝난 요청 하나 → 기록 파일, build.py가 다시 읽을 수 있게
import import_anotar, json as _json
job = {"id": "4419d11b-x", "memo": 1, "title": "", "memo_text": "\n[GPT] dev, day\n둘째 줄",
       "request": _json.dumps({"template": {"name": "키워드 리서치"}, "execution": {"model": "a,b"}}),
       "runner": None, "result": _json.dumps({"markdown": "> 안내\n# 제목\n- **첫** 문장 [링크](https://x.test)\n", "sources": [{"url": "https://x.test", "title": "X"}]}),
       "started": "2026-09-29T13:08:28.100Z", "finished": "2026-09-29T13:09:00.000Z"}
t = pathlib.Path(tempfile.mkdtemp()) / "r.md"
t.write_text(import_anotar.record(job), encoding="utf-8")
r = build.parse(t, build.ANOTAR_KEYS)
assert r["title"] == "GPT dev, day" and r["tldr"] == "첫 문장 링크", r
assert r["template"] == "키워드 리서치" and r["source"] == "memo" and r["date"] == "2026-09-29" and r["started"] == "2026-09-29T22:08", r
assert r["models"] == ["a b"] and r["promoted"] == [] and "## 출처\n\n- [X](https://x.test)" in r["body"], r
print("ok anotar record")
