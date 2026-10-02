---
id: rf-sk3x
status: closed
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, worker, durable-object]
---
# Phase 1.2: Registry Durable Object (link state, quotas, sweeper alarm)

## Why
All link state must be strongly consistent (allocate/refresh/revoke must be atomic; KV's eventual consistency would make refresh/revoke flaky), code allocation must be collision-free, and expired objects must be cleaned up without a cron. One SQLite-backed Durable Object does all of this and, with a single instance, has a bounded cost (see docs/PLAN.md section 5).

## What was done (packages/worker/src/registry.ts)
- Table `links(code PK, r2_key, filename, content_type, size, created_at, ttl_seconds, expires_at, max_downloads, hits, window_hits, last_hit_at, state)` and `uploads(day, count)`. `state` is `pending` (allocated, bytes not committed), `active`, or `purging` (being swept).
- RPC methods: `allocate` (validates size/ttl/maxDownloads, enforces daily-upload and total-bytes quotas, picks a unique code or uses an explicit one for PUT re-create), `commit` (starts the expiry window), `abort`, `resolve(code, count)` (single atomic lookup + hit count; returns ok/expired/exhausted/notfound), `get`, `lookup`, `status`, `refresh` (new window from now, resets per-window download counter, rejects ttl above max), `revoke` (expire now), `purge`.
- Sweeper `alarm()`: flips due rows (active past expires_at + grace, or stale pending) to `purging` SYNCHRONOUSLY, then deletes R2 objects, then rows; rows left `purging` after a failed R2 delete are retried. The alarm is only scheduled for the next due cleanup (`ensureAlarm`/`nextDue`) and not rescheduled when empty, so the DO is idle with no live links.
- Codes: 8 base58 chars, CSPRNG with rejection sampling (packages/worker/src/code.ts). Single instance via `registryStub` (src/stub.ts).

## Acceptance Criteria

- [x] allocate/commit/resolve/refresh/revoke/purge behave as above and are covered by packages/worker/test/links.test.ts.
- [x] Quota enforcement (total bytes, uploads/day, file size, ttl) returns typed errors.
- [x] After the sweep leaves nothing due, `getAlarm()` is null (asserted in tests).
- [x] A refresh or serve that races a sweep is refused rather than acknowledged then lost (packages/worker/test/races.test.ts).


## Notes

**2026-10-02T20:05:52Z**

Implemented and reviewed in PR #1 (branch feat/phase-1-worker-cli); closed as part of the epic setup.
