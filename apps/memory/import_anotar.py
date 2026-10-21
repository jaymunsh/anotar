"""anotar 서버의 AI 요청 결과 → anotar/*.md (Mac 세션 기록 sessions/와 따로). 데이터 repo 루트에서 실행한다.

  python3 import_anotar.py            서버에서 SSH로 읽어 온다 (apps/anotar/.env.oracle-server의 ORACLE_SSH_*)
  python3 import_anotar.py <db 경로>   그 SQLite에서 읽는다 (로컬 확인용)

서버 DB는 읽기 전용으로 열고, 서버에 파일을 두지 않는다(읽는 스크립트를 SSH 입력으로 보낸다).
결과가 나온 요청만, 원본 메모·페이지가 지워지지 않은 것만 가져온다. 이미 있는 파일은 건드리지 않는다
(결과는 끝나면 바뀌지 않고, promoted를 지키려고). 요약 AI를 거치지 않는다: 결과가 이미 AI가 쓴 글이다.
요청한 메모·페이지 본문은 옮기지 않는다(비밀값이 섞일 수 있음). 제목 한 줄만 쓴다.
"""
import json, os, re, subprocess, sys
from datetime import date, timedelta

import build
from import_sessions import kst

DATA = build.DATA
OUT = DATA / "anotar"
ENV = build.CODE.parent / "anotar/.env.oracle-server"
SERVER_DB = "/srv/leneu/data-live/storage.sqlite"

# Runs on the server (python3 stdin) or locally: prints finished jobs since argv[2] as JSON.
EXPORT = r'''
import json, sqlite3, sys
db = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
rows = db.execute("""SELECT j.id, j.capture_id IS NOT NULL, COALESCE(j.source_title, ''), COALESCE(c.text, ''),
  j.request_json, j.runner_json, j.result_json, j.started_at, j.finished_at
  FROM ai_jobs j LEFT JOIN captures c ON c.id = j.capture_id LEFT JOIN pages p ON p.id = j.page_id
  WHERE j.status = 'result_ready' AND j.finished_at >= ? AND c.deleted_at IS NULL AND p.deleted_at IS NULL
  ORDER BY j.finished_at""", (sys.argv[2],)).fetchall()
keys = ("id", "memo", "title", "memo_text", "request", "runner", "result", "started", "finished")
print(json.dumps([dict(zip(keys, r)) for r in rows], ensure_ascii=False))
'''


def fetch(since, db=None):
    if db:
        cmd = [sys.executable, "-c", EXPORT, db, since]
    else:
        env = dict(re.findall(r"^(ORACLE_SSH_\w+)=\"?([^\"\n]*)\"?$", ENV.read_text(), re.M))
        cmd = ["ssh", "-i", os.path.expanduser(env["ORACLE_SSH_KEY"]), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
               f"{env['ORACLE_SSH_USER']}@{env['ORACLE_SSH_HOST']}", "sudo", "python3", "-", SERVER_DB, since]
    out = subprocess.run(cmd, input=None if db else EXPORT, capture_output=True, text=True, timeout=120, check=True)
    return json.loads(out.stdout)


def one_line(text, n):
    text = re.sub(r"\s+", " ", re.sub(r"[#>*_`\[\]]|\(http\S*\)", "", text)).strip()
    return text if len(text) <= n else text[:n].rstrip() + "…"


def record(job):
    """One finished job as a record file: frontmatter + the result Markdown + its sources."""
    request, result = json.loads(job["request"]), json.loads(job["result"] or "{}")
    runner = json.loads(job["runner"] or "{}")
    template = (request.get("template") or {}).get("name") or "직접 요청"
    subject = job["title"] or next((l for l in job["memo_text"].splitlines() if l.strip()), "") or "(제목 없음)"
    markdown = (result.get("markdown") or "").strip()
    lines = [l for l in markdown.splitlines() if l.strip() and not l.lstrip().startswith(("#", ">"))]
    # The first plain line of the result, without its list marker.
    first = re.sub(r"^\s*(?:[-+]|\d+\.)\s+", "", lines[0]) if lines else "(결과 없음)"
    model = (request.get("execution") or {}).get("model") or runner.get("label") or ""
    sources = [f"- [{s.get('title') or s['url']}]({s['url']})" for s in result.get("sources") or [] if s.get("url")]
    started = kst(job["started"] or job["finished"])
    return (f"---\ntitle: {one_line(subject, 60)}\ntldr: {one_line(first, 160)}\n"
            f"tool: anotar\ntemplate: {one_line(template, 40)}\nsource: {'memo' if job['memo'] else 'page'}\n"
            f"models: [{one_line(model, 60).replace(',', ' ')}]\ndate: {started[:10]}\nstarted: {started}\n"
            f"ended: {kst(job['finished'])}\npromoted: []\n---\n\n{markdown}\n"
            + ("\n## 출처\n\n" + "\n".join(sources) + "\n" if sources else ""))


def main(db=None):
    OUT.mkdir(exist_ok=True)
    days = sorted(p.name[:10] for p in OUT.glob("*.md"))
    # A day back from the newest record: jobs finished late that day are re-read, existing files skipped.
    since = (date.fromisoformat(days[-1]) - timedelta(days=1)).isoformat() if days else "1970-01-01"
    added = 0
    for job in fetch(since, db):
        path = OUT / f"{kst(job['started'] or job['finished'])[:10]}-{job['id'][:8]}.md"
        if not path.exists():
            path.write_text(record(job), encoding="utf-8")
            added += 1
    print(f"anotar/: 서버 AI 기록 {added}개 추가")


if __name__ == "__main__":
    try:
        main(sys.argv[1] if len(sys.argv) > 1 else None)
    except (OSError, KeyError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        # Never print the command or env: they hold the server address and key path.
        sys.exit(f"서버 AI 기록을 가져오지 못함 ({type(error).__name__})")
