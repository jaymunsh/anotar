#!/usr/bin/env python3
"""Reject a release that changes persistent mounts before replacing containers."""
import json
import os
import subprocess
import sys

REQUIRED = {
    "storage": {"/data": False, "/backups": False, "/sites": False},
    "share": {"/data": True},
    "sites": {"/sites": True},
}


def validate(config, current):
    for service, targets in REQUIRED.items():
        candidate = {v["target"]: v for v in config["services"][service]["volumes"]}
        existing = {v["Destination"]: v for v in current[service]["Mounts"]}
        for target, readonly in targets.items():
            new, old = candidate[target], existing[target]
            source = new.get("source", "")
            if (
                new.get("type") != "bind"
                or old.get("Type") != "bind"
                or not os.path.isabs(source)
                or not os.path.isdir(source)
                or os.path.realpath(source) != os.path.realpath(old["Source"])
                or bool(new.get("read_only", False)) != readonly
                or bool(old["RW"]) == readonly
            ):
                raise ValueError("persistent_mount_mismatch")


def main():
    # Compose output includes environment secrets: capture it, never print it.
    config = json.loads(subprocess.check_output([
        "docker", "compose", "--project-name", "app", "-f", "compose.yaml",
        "-f", "compose.oracle.yaml", "config", "--format", "json",
    ], stderr=subprocess.DEVNULL))
    current = {
        service: json.loads(subprocess.check_output([
            "docker", "inspect", f"app-{service}-1",
        ], stderr=subprocess.DEVNULL))[0]
        for service in REQUIRED
    }
    validate(config, current)
    print("Persistent mounts verified; public mounts remain read-only.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Deployment rejected: persistent mounts could not be verified.", file=sys.stderr)
        sys.exit(1)
