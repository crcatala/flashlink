---
id: rf-dd4u
status: open
deps: [rf-rxkx]
links: []
created: 2026-10-02T20:05:53Z
type: bug
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, worker, deferred]
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

- [ ] Policy decided and documented in docs/PLAN.md (replace the known-limitation entry in section 9).
- [ ] Regression tests listed above pass and fail on the old behavior.
- [ ] Still exactly one DO call per fetch (asserted: the fetch path test counts registry calls through a proxy).
- [ ] README text for `--max-downloads` states what counts as a download.

