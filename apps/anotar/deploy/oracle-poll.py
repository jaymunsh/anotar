#!/usr/bin/env python3
"""Pull only a successful main workflow; no inbound GitHub SSH or API token.

oracle-poll.py [anotar|harukan] — anotar (default) waits for oracle.yml, harukan for harukan.yml.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOSITORY = "jaymunsh/anotar"
SERVICES = {
    "anotar": ("oracle.yml", "/var/lib/anotar-deploy/state.json", "/srv/leneu/deployed-commit", "/usr/local/sbin/anotar-deploy"),
    "harukan": ("harukan.yml", "/var/lib/harukan-deploy/state.json", "/srv/anotar-planner/deployed-commit", "/usr/local/sbin/harukan-deploy"),
}
NAME = sys.argv[1] if len(sys.argv) > 1 else "anotar"
WORKFLOW, STATE, CURRENT, DEPLOY = SERVICES[NAME]
STATE, CURRENT = Path(STATE), Path(CURRENT)
ENDPOINT = (
    f"https://api.github.com/repos/{REPOSITORY}/actions/workflows/{WORKFLOW}/runs"
    "?branch=main&status=success&per_page=1"
)


def eligible(run):
    return (
        run.get("head_branch") == "main"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("event") in ("push", "workflow_dispatch")
        and run.get("path") == ".github/workflows/" + WORKFLOW
        and run.get("head_repository", {}).get("full_name") == REPOSITORY
        and bool(re.fullmatch(r"[a-f0-9]{40}", run.get("head_sha", "")))
    )


def notify(kind, *lines):
    # Same shape as the server watchers: '<icon> <kind> · <name> 배포', KST time, then the lines.
    icon = "🟢" if kind == "복구" else "🔴"
    when = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M KST")
    text = f"{icon} {kind} · {NAME} 배포\n{when}\n\n" + "\n".join(lines)
    try:
        values = {}
        for line in Path("/etc/leneu-oracle-alerts/service-telegram.env").read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip().strip("\"'")
        request = urllib.request.Request(
            "https://api.telegram.org/bot" + values["TELEGRAM_BOT_TOKEN"] + "/sendMessage",
            data=json.dumps({"chat_id": values["TELEGRAM_CHAT_ID"], "text": text}).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return bool(json.load(response).get("ok"))
    except Exception:
        # Never print the exception: a URL may contain the bot credential.
        print("Deployment notification unavailable.", file=sys.stderr)
        return False


def save(state):
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(state))
    temp.chmod(0o600)
    temp.replace(STATE)


def main():
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    try:
        request = urllib.request.Request(ENDPOINT, headers={
            "Accept": "application/vnd.github+json", "User-Agent": NAME + "-deploy",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError("response_too_large")
            runs = json.loads(raw)["workflow_runs"]
    except Exception:
        state["connection_failures"] = state.get("connection_failures", 0) + 1
        if state["connection_failures"] >= 3 and not state.get("connection_alert"):
            state["connection_alert"] = notify("경고", "• GitHub 검사 결과를 3번 연속 확인하지 못했어요.", "", "지금 서비스는 그대로예요. 다음 확인: 2분 뒤 자동")
        save(state)
        print("GitHub verification temporarily unavailable; existing release retained.")
        return 1
    if state.get("connection_alert"):
        if notify("복구", "GitHub 검사 결과 확인이 정상으로 돌아왔어요."):
            state.pop("connection_alert", None)
    state["connection_failures"] = 0
    save(state)
    if not runs or not eligible(runs[0]):
        print("No eligible successful main workflow.")
        return 0
    commit = runs[0]["head_sha"]
    if CURRENT.exists() and CURRENT.read_text().strip() == commit:
        if state.get("failed_commit"):
            if notify("복구", "릴리스가 정상 배포됐어요.", "커밋: " + commit[:12]):
                state.pop("failed_commit", None)
        for key in ("attempt_commit", "attempt_count", "retry_after"):
            state.pop(key, None)
        save(state)
        print("Verified release already deployed.")
        return 0
    if state.get("attempt_commit") != commit:
        state.update(attempt_commit=commit, attempt_count=0, retry_after=0)
    if state.get("attempt_count", 0) >= 3:
        print("Three attempts failed; waiting for a new verified commit or operator repair.")
        return 0
    if time.time() < state.get("retry_after", 0):
        print("Deployment retry deferred.")
        return 0
    state["attempt_count"] += 1
    state["retry_after"] = time.time() + (300, 900, 3600)[state["attempt_count"] - 1]
    save(state)
    result = subprocess.run([DEPLOY, "deploy " + commit], check=False)
    if result.returncode in (65, 75):
        state["attempt_count"] -= 1
        state["retry_after"] = 0
        save(state)
        print("Main changed or deployment busy; check again next interval.")
        return 0
    if result.returncode:
        if state.get("failed_commit") != commit:
            if notify("경고", "• 검사를 통과한 릴리스 배포가 실패했어요. 이전 버전으로 유지돼요.", "• 커밋: " + commit[:12], "", f"확인: sudo journalctl -u {NAME}-deploy.service"):
                state["failed_commit"] = commit
        save(state)
        return 1
    if state.get("failed_commit"):
        if notify("복구", "새 릴리스가 정상 배포됐어요.", "커밋: " + commit[:12]):
            state.pop("failed_commit", None)
    for key in ("attempt_commit", "attempt_count", "retry_after"):
        state.pop(key, None)
    save(state)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Deployment poll failed; inspect local configuration.", file=sys.stderr)
        sys.exit(1)
