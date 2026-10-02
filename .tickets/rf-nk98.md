---
id: rf-nk98
status: closed
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, worker]
---
# Phase 1.3: Public serving path (GET/HEAD /<code>) with response hardening

## Why
The point of the product: an agent can `curl` the short link and get the file, until it expires. R2 is private, so the Worker must enforce expiry and stream the object itself.

## What was done (packages/worker/src/serve.ts, http.ts)
- `GET|HEAD /<code>` and `/<code>/<anything>` (the suffix is cosmetic). Order: regex-validate code -> per-IP limit -> global limit -> one `resolve` -> stream from R2.
- 404 unknown, 410 expired/revoked/over download cap, 416 unsatisfiable Range, 200/206 otherwise. Single `Range` header supported (own parser in http.ts, multi-range ignored); HEAD supported and does not count a hit.
- Headers: Content-Type (sanitized; charset added for text/*), Content-Disposition inline with ASCII fallback + RFC 5987 name, Accept-Ranges, Cache-Control no-store, X-Content-Type-Options nosniff, Referrer-Policy no-referrer, X-Robots-Tag noindex; `Content-Security-Policy: sandbox` only for active content types (HTML/SVG/XML) because sandbox breaks inline PDF viewing in some browsers.

## Acceptance Criteria

- [x] Round trip of text and binary data is byte-identical (also verified against `wrangler dev`).
- [x] Range (a-b, a-, -n), 416, HEAD behavior covered by tests.
- [x] Hostile filenames/content types are sanitized (tests in links.test.ts and http.test.ts).
- [x] Malformed codes get 404 without touching the Durable Object (asserted via a throwing registry stub).


## Notes

**2026-10-02T20:05:52Z**

Implemented and reviewed in PR #1 (branch feat/phase-1-worker-cli); closed as part of the epic setup.
