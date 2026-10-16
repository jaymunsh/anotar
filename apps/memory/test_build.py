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
print("ok")
