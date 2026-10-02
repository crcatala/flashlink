---
id: rf-zpbg
status: closed
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, cli]
---
# Phase 1.7: CLI refresh, revoke, ls, status and local history

## Why
Links must be manageable after the fact: re-open one for another window under the SAME URL, close one early, and see what was shared. History is local-only by design (no server listing endpoint).

## What was done
- Local history (packages/cli/src/history.ts): one JSON file (atomic write, mode 600) with code, url, filename, size, content type, sha256, absolute source path, timestamps, ttl, hits, state (active/revoked/purged/exhausted).
- `r2fl refresh [link]` (code or any link URL; no argument = latest upload; `--ttl`). If the server already purged the object it re-uploads the original local file under the SAME code via PUT, but only if the SHA-256 still matches.
- `r2fl revoke <link> [--purge]`, `r2fl ls` (`--live/--all/--limit/--json/--sync`; `--sync` folds server expiry/hits/purge/exhausted state into local history), `r2fl status` (server limits + usage).

## Acceptance Criteria

- [x] Refreshing an expired link keeps the same URL and updates history (also verified against `wrangler dev`).
- [x] Re-upload after purge works for an unchanged file and is refused (with a clear message) when the file changed, is gone, came from stdin, or is unknown.
- [x] `ls` shows live/exhausted/expired/revoked/purged correctly, including after `--sync`.
- [x] Covered by packages/cli/test/lifecycle.test.ts and misc.test.ts.


## Notes

**2026-10-02T20:05:53Z**

Implemented and reviewed in PR #1 (branch feat/phase-1-worker-cli); closed as part of the epic setup.
