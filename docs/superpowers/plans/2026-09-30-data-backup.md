# Data Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and restore verified SQLite plus referenced-blob snapshots without overwriting user data.

**Architecture:** Use Node 24 `node:sqlite.backup` for WAL-safe DB snapshots. A standalone module copies only keys referenced by the snapshot, records checksums, and uses temporary sibling directories plus rename for atomic publication. A CLI exposes create, verify, and restore.

**Tech Stack:** Node 24 built-ins, `node:sqlite`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-30-data-backup-design.md`

## Global Constraints

- Never overwrite `data/`, an existing backup, or an existing restore target.
- Do not write the original DB or blobs; use test temporary directories.
- Failed create/restore must not leave a directory that looks complete.
- Reject unsafe blob names and symlinks.

## Review Focus

- Source DB changes during snapshot: copied blob set must come from the resulting snapshot.
- Missing or changed blob: no complete backup published.
- Tampered manifest/DB/blob: verify and restore reject it.
- Duplicate asset keys: copy once and validate expected size.
- Output path nesting: no recursive copy or user data overwrite.

---

### Task 1: Verified snapshot and restore

**Files:**
- Create: `server/backups.mjs`
- Create: `scripts/backup-data.mjs`
- Test: `test/backups.test.mjs`
- Modify: `package.json`
- Modify: `README.md`, `CURRENT_IMPLEMENTATION.md`, `PLAN.md`

**Interfaces:**
- `createBackup(dataDir: string, backupDir: string): Promise<object>` creates a complete directory and returns the manifest.
- `verifyBackup(backupDir: string): Promise<object>` validates checksums, DB integrity, and referenced files.
- `restoreBackup(backupDir: string, targetDataDir: string): Promise<object>` creates a new data directory after verification.

- [x] Write tests for open-WAL DB and blob restore, corruption/missing source, existing targets, and unsafe paths.
- [x] Run `node --test test/backups.test.mjs` to observe missing module failure.
- [x] Implement module and CLI with temporary staging and strict verification.
- [x] Run focused and full tests, build, and CLI smoke on an isolated fixture.
- [x] Document exact commands and the current manual-schedule limit.
