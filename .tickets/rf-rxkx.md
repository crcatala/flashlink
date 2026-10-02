---
id: rf-rxkx
status: open
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 1
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, verification, infra, needs-human]
---
# Verify the deployment on a real Cloudflare account

## Why
Everything in phase 1 was built and tested against the LOCAL simulator (workerd/Miniflare via `wrangler dev` and vitest-pool-workers). Nothing has run on a real Cloudflare account. Several behaviors can only be confirmed for real: the Rate Limiting binding, R2 under real network conditions, Content-Length handling through Cloudflare's proxy for uploads, the DO billing view, custom-domain routing, and whether the README deploy steps actually work from a clean account. This must happen before the repo is made public and before phase 2 builds on it.

## Scope
Follow the README "Deploy your own" section literally on a real (ideally the owner's) Cloudflare account, then exercise the live deployment with the real CLI. Record findings.

## Design

Checklist to run and record (put results in `tk add-note`, file a bug ticket under this epic for each discrepancy):
1. Fresh clone: `pnpm install`, create bucket `r2-fastlink`, `openssl rand -hex 32` token, `wrangler secret put UPLOAD_TOKEN`, add the 30-day lifecycle rule exactly as the README says, `wrangler deploy`. Note any step that fails or is unclear and fix the README.
2. Confirm the DO migration applied as SQLite-backed (dashboard: Durable Objects -> Registry) and that exactly ONE instance exists after several uploads/fetches.
3. `r2fl init` against the workers.dev URL; upload small text, a ~1 MB image, a ~49 MB file (should work) and a 51 MB file (client refuses; also test the server 413 by raising the client cap with `r2fl config set maxFileBytes 100MB`).
4. Upload uses `Content-Length` (server answers 411 without it). Confirm Cloudflare's proxy preserves it for real uploads of all sizes and that large uploads do not time out.
5. Fetch with `curl` and a browser; Range (`curl -r 0-99`); HEAD; `Cache-Control: no-store` present on 200 AND on 404/410; confirm a repeated fetch after expiry is 410 (no stale cache).
6. TTL 5s upload: fetch ok, wait, 410, `r2fl refresh` same URL works. Revoke/purge/re-upload-after-purge.
7. Rate limiting: from one IP, loop `curl` on a bogus code; confirm 429s start (per-location and approximate: note the observed threshold). Confirm normal use is not throttled.
8. Optionally attach a custom domain/route; set `PUBLIC_BASE_URL`; confirm returned URLs use it.
9. After a day: check Workers/DO/R2 usage in the dashboard against docs/PLAN.md section 5 expectations (DO requests count, duration near zero when idle). Confirm the sweeper purges an expired link after the grace period (can temporarily set `PURGE_GRACE_SECONDS` small to test, then restore).
10. Confirm the lifecycle rule exists (`wrangler r2 bucket lifecycle list r2-fastlink`).

## Acceptance Criteria

- [ ] Every checklist item executed against a real Cloudflare deployment, with results recorded as notes on this ticket.
- [ ] README "Deploy your own" corrected wherever it diverged from reality (commands, flags, ordering, caveats).
- [ ] Any discovered defect has its own ticket (type bug, parent = this epic) or is fixed in the same PR with a regression test.
- [ ] docs/PLAN.md section 5 updated if real behavior or costs differ from the model; the "Not verified" caveat in the phase-1 notes is removed or restated.
- [ ] No secrets, account IDs or tokens committed.

