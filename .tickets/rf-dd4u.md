---
id: rf-dd4u
status: closed
deps: [rf-rxkx]
links: []
created: 2026-10-02T20:05:53Z
type: bug
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, worker, deferred, batch-09]
---
# Download-cap accounting policy for Range/416 requests

## Why
(Deferred item from the PR #1 review.) With `--max-downloads N`, EVERY `GET` that reaches the registry counts against the cap, including unsatisfiable Range requests (416), requests whose R2 object turns out to be missing, and each partial request from clients that fetch in ranges (a video player makes several). The effect is conservative (links close early, never late) and the cap is opt-in, but it makes `-d 1` unreliable for media and surprising for failed requests.

## Constraint
Do NOT add a second Durable Object call per fetch (invariant 1/3 in the epic: one registry call per fetch keeps DO cost bounded).

## Design

Needs an explicit policy first (record the decision in a note and in docs/PLAN.md section 9). Candidate policy: count a download only when the request is satisfiable AND is either a full request (no Range) or a range starting at offset 0 (the first request of a ranged client); never count 416, never count a request whose object is missing.
Implementation idea within one DO call: pass the raw `Range` header (or parsed first/last) into `Registry.resolve(code, count, range?)` so the DO, which already knows `size`, decides whether to count; keep `parseRange` in packages/worker/src/http.ts as the single parser (move or import it so the DO can use it). For the missing-object case either verify the object exists before counting (an R2 `head` costs an extra R2 op but not a DO call; measure) or accept and document it.
Tests: 416 does not consume the cap; a ranged request starting at 0 counts once; later ranges of the same logical download do not count; the full-request path is unchanged; `window_hits` reset by refresh still works.

## Acceptance Criteria

- [x] Policy decided and documented in docs/PLAN.md (replace the known-limitation entry in section 9).
- [x] Regression tests listed above pass and fail on the old behavior.
- [x] Still exactly one DO call per fetch (asserted: the fetch path test counts registry calls through a proxy).
- [x] README text for `--max-downloads` states what counts as a download.


## Notes

**2026-10-03T21:29:57Z**

2026-10-03 reorder: moved from batch-08 to batch-09, after the dogfooding checkpoint. Rationale: whether -d/--max-downloads is unreliable enough to matter is best judged after real use (especially -d 1 on screenshots/videos), and rf-bi4a (usage check) should be done first. See docs/AGENT_PROMPT.md, 'Checkpoints'.

**2026-10-03T23:52:49Z**

2026-10-03 (branch batch-09-download-cap-policy): policy implemented and documented in docs/PLAN.md section 9. Registry.resolve(code, count, range) counts a hit only for a GET that is satisfiable and has no usable Range or a range starting at offset 0 (countsAsDownload, using the single parseRange in http.ts). 416 and later ranges never count; HEAD never counted (unchanged); the cap still gates all requests once reached. Still one DO call per fetch (test counts stub calls). Deviations/decisions: (1) missing-object case NOT fixed, documented: no extra R2 head (the key comes from the registry, so it would also need to run after the call, costing an R2 op per fetch for an almost unreachable case). (2) Known tradeoff: ranges starting after byte 0 never consume the cap, so a link holder can read bytes 1.. of a capped link until expiry; -d is documented as a convenience, not a lock. Closing that needs per-window byte accounting (schema migration), not done. (3) -d 1 with a multi-range client fails on its 2nd request by design. Evidence: tests fail on old behavior (3 new tests fail with counting forced on), pnpm test 26+303+97 pass, exercised against wrangler dev with the built CLI.

**2026-10-04T00:16:11Z**

2026-10-03 REVISED after review (PR #19): the first policy (count only no-Range or range-from-byte-0) let 'Range: bytes=1-' read a capped link without limit, a regression from the old fail-closed cap. Now every satisfiable GET counts (ranged or not); only HEAD and 416 are free. The cap still gates all requests once reached. Ranged clients (players, resumable downloaders, Safari's bytes=0-1 probe) spend one count per request and can be cut off at any N; README/PLAN/skill now say -d is for plain fetches and no longer suggest -d 2+ as a workaround. hits/lastHitAt are now documented (core types, PLAN, README) as counted fetches for every link, capped or not, and tested on an unlimited link. Byte-based per-window accounting remains the stronger option, not done (schema migration). Evidence: pnpm test 26+303+98 pass; 6 tests fail against the previous policy.
