---
id: rf-xmo4
status: closed
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: task
priority: 1
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, worker, cli, hardening]
---
# Phase 1.9: Post-review hardening (sweeper race, late uploads, no-store, Node engines, exhausted state)

## Why
An independent review of PR #1 found real problems; each was verified against the code (several with throwaway repros) before fixing.

## What was done
1. Sweeper vs refresh race: the alarm awaited R2 then deleted rows unconditionally, so a refresh landing mid-sweep was acknowledged then lost. Fixed with the synchronous `purging` state (also used by explicit purge); rows stuck `purging` are retried.
2. Late uploads: if the pending row was reaped before `commit` (very slow upload) the written object was never deleted. Now removed unless a live link owns the code. The R2 lifecycle backstop (30 days) that the plan promised was added to the README deploy steps.
3. Node requirement: commander@15 needs Node >= 22.12 and wrangler@4 needs >= 22, not 20. Engines, tsup target, README, `.node-version` updated; a test fails if the CLI's declared minimum drops below its dependencies' requirements.
4. Every Worker response (including 404/410/416/429/503/API errors) now has Cache-Control: no-store.
5. `ls --sync` listed download-capped links as live; history has an `exhausted` state that refresh clears.
6. DEFERRED: invalid/partial Range requests consume the download cap (see the "Download-cap accounting policy" ticket).

## Acceptance Criteria

- [x] Each fix has a regression test that fails on the old code (verified by running the new tests against the previous source).
- [x] Full suite green (162 tests at time of closing), typecheck/build/format clean, fixes smoke-tested against `wrangler dev`.


## Notes

**2026-10-02T20:05:53Z**

Implemented and reviewed in PR #1 (branch feat/phase-1-worker-cli); closed as part of the epic setup.
