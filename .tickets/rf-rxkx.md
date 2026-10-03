---
id: rf-rxkx
status: closed
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 1
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, verification, infra, needs-human, batch-02]
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

- [x] Every checklist item executed against a real Cloudflare deployment, with results recorded as notes on this ticket. (Items 8 and the usage-after-a-day half of item 9 were moved to rf-bi4a by the owner so this ticket could close; every other item was executed.)
- [x] README "Deploy your own" corrected wherever it diverged from reality (commands, flags, ordering, caveats).
- [x] Any discovered defect has its own ticket (type bug, parent = this epic) or is fixed in the same PR with a regression test.
- [x] docs/PLAN.md section 5 updated if real behavior or costs differ from the model; the "Not verified" caveat in the phase-1 notes is removed or restated. (Restated in PLAN section 7 with the real results; the numeric comparison after a day of use is tracked in rf-bi4a.)
- [x] No secrets, account IDs or tokens committed.


## Notes

**2026-10-02T20:20:30Z**

SCOPE FOR AN AGENT (batch-02): an agent cannot reach a real Cloudflare account. Its deliverable is a runbook + automation the owner runs: add scripts/verify-deployment.mjs (Node, no new deps) that takes --endpoint and a token (env R2FL_TOKEN) and exercises checklist items 3-7 (uploads of several sizes, 411 without Content-Length, Range/HEAD, no-store on 200/404/410, TTL expiry + refresh, revoke/purge/re-upload, rate-limit probing) printing a pass/fail report; validate the script itself against a local wrangler dev; add docs/VERIFY_DEPLOYMENT.md with the manual-only items (dashboard checks for items 2, 8, 9, 10). The ticket stays in_progress with an AWAITING HUMAN note until the owner runs it against the real deployment and records results. Tickets rf-dd4u, rf-dt1g, rf-v39y and rf-l2ym stay blocked until this ticket is closed.

**2026-10-02T22:35:26Z**

AWAITING HUMAN: agent part done on branch batch-02-verify-deployment (scripts/verify-deployment.mjs + docs/VERIFY_DEPLOYMENT.md; README and PLAN.md updated). Validated the script against wrangler dev: 31/31 checks pass (incl. 411, 413, Range/HEAD/no-store, 5s TTL expiry+refresh, revoke, purge+re-upload, max-downloads, sweeper with PURGE_GRACE_SECONDS=20, rate limit first 429 at request ~43-52); a mutation (Cache-Control changed to max-age on served files) made the script FAIL 4 checks, so it detects regressions. Also ran the runbook's CLI sequence locally (client refuses 51 MiB, server answers 413 after raising maxFileBytes, 5s link 410 -> refresh -> 200). Nothing was run against real Cloudflare. Remaining for the owner, in order: (1) follow README 'Deploy your own' literally on a real account and fix anything unclear; (2) R2FL_TOKEN=... node scripts/verify-deployment.mjs --endpoint https://<worker>  (about 2 min; FAIL -> bug ticket under rf-dek6; note the rate-limit threshold); (3) the CLI block in docs/VERIFY_DEPLOYMENT.md section 3; (4) dashboard checks: item 2 (exactly one SQLite Registry instance), item 8 (custom domain + PUBLIC_BASE_URL, optional), item 9 (usage after a day vs PLAN section 5; sweeper run with 'wrangler deploy --var PURGE_GRACE_SECONDS:20' then restore), item 10 (wrangler r2 bucket lifecycle list r2-fastlink). Then record results as notes here, tick the criteria you verified, update PLAN section 5 if numbers differ, and tk close rf-rxkx (which unblocks rf-dd4u, rf-dt1g, rf-v39y, rf-l2ym). Details: docs/VERIFY_DEPLOYMENT.md sections 2-5.

**2026-10-03T01:04:48Z**

Review follow-up on PR #4 (script fixes, same branch): (1) sweeper check no longer trusts a 404 from GET /api/links/:code (a 'purging' row is also 404 while R2 delete is in flight or failing); it now waits 3s and requires DELETE to answer 404 (row gone = R2 delete confirmed), else FAIL. (2) cleanup is best-effort and aggregates failures. (3) HEAD hit-count check asserts status 200 and integer hits on both reads (previously undefined === undefined passed). Verified by mutation against wrangler dev: old script falsely PASSED the HEAD check (GET /api/links/:code -> 500) and the sweeper check (alarm throwing before the R2 delete); new script FAILs both; cleanup with every DELETE failing now lists all codes. Clean run: 31/31. Still nothing run on real Cloudflare; AWAITING HUMAN note above stands.

**2026-10-03T02:51:14Z**

2026-10-02: the Worker secret is now named R2FL_TOKEN (was UPLOAD_TOKEN); the step 'wrangler secret put UPLOAD_TOKEN' above means 'wrangler secret put R2FL_TOKEN'. The bucket is created with --no-update-config, and wrangler.jsonc sets workers_dev/preview_urls. See the follow-up PR from branch fix/rename-upload-token-wrangler-config.

**2026-10-03T03:33:25Z**

Owner ran the checklist on a real account (2026-10-03), branch fix/verification-followups. Results (details in docs/PLAN.md section 7): item 1 deploy worked after fixes already merged (PR #6: R2FL_TOKEN rename, workers_dev/preview_urls, --no-update-config); item 2 DO is SQL, exactly one object (same ID listed twice in the dashboard, named + bare ID), 299 DO requests/0 errors in 24h, links table empty after cleanup; items 3-6 pass via verify script (49 MiB up in 19.1s, 413 over cap, Range/HEAD, no-store, expiry/refresh/revoke/purge, max-downloads); item 4: Cloudflare's edge supplies Content-Length for a chunked upload (201 instead of 411, bytes stored intact) and a chunked 60 MB upload is refused 413, so the cap holds; script's 411 check relaxed and a chunked over-limit check added (mutation of the Worker to accept a missing length makes both fail); item 7: rate limiter NEVER returned 429 (150 req/1.2s, 200 req/~50s) -> bug rf-77fd; item 9 sweeper PASS with PURGE_GRACE_SECONDS=20 and grace restored to 604800; item 10 expire-strays rule present. REMAINING (AWAITING HUMAN): item 9 usage after about a day vs PLAN section 5 (dashboard DO requests/duration/rows, Worker and R2 ops), item 8 custom domain (optional), and resolving rf-77fd (not a blocker for closing this ticket if you accept it as a separate bug).

**2026-10-03T03:50:11Z**

Item 7 (rate limiting) resolved: limiter is attached and enforcing but lenient (3/10s test limit let 31 of 40 sequential requests through, 9 got 429); see rf-77fd (closed) and docs/PLAN.md section 7. Remaining for this ticket: item 9 usage after about a day (dashboard vs PLAN section 5), optional item 8, and re-running verify-deployment.mjs --skip-ratelimit after PR #7's script changes. AWAITING HUMAN note above still applies for those.

**2026-10-03T03:50:50Z**

Re-ran scripts/verify-deployment.mjs --skip-ratelimit on the real deployment after PR #7 (2026-10-03): 30 passed, 0 failed, 0 warnings, 2 skipped (sweeper and rate limit, both verified separately). Both new chunked checks PASS (chunked upload accepted with the edge-supplied length and stored intact; chunked one-byte-over-limit refused 413 file_too_large). 49 MiB up in 21.3 s (2.3 MiB/s), down in 3.8 s. Remaining for this ticket: item 9 usage after about a day vs PLAN section 5, and optional item 8 (custom domain).

**2026-10-03T04:02:16Z**

Closing by owner decision. Items 1-7, 9 (sweeper) and 10 are done and recorded above (PLAN section 7). The two items that need elapsed time or an optional setup, item 9 usage after about a day vs PLAN section 5 and item 8 custom domain, moved to rf-bi4a, which blocks rf-l2ym (edge cache, the only ticket that needs those numbers). This unblocks rf-dd4u, rf-v39y and rf-dt1g (the latter also waits on rf-cr7d).
