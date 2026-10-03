---
id: rf-77fd
status: closed
deps: []
links: []
created: 2026-10-03T03:33:17Z
type: bug
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, worker, security, cost]
---
# Per-IP rate limiter never returned 429 on a real deployment

Observed on the owner's real Cloudflare deployment (2026-10-03): 150 requests in 1.2 s, then 200 requests over ~50 s (~4/s, limit 60/60s) from one IP to a well-formed unknown code all returned 404, never 429. The same script check passes against wrangler dev (first 429 at request ~43-52). Cloudflare documents the Rate Limiting binding as permissive/eventually consistent but this is far beyond that. Hypotheses: (1) the binding throws on real Cloudflare and withinLimit fails open silently (now logged as 'rate limiter failed open'); (2) counters are cached per machine and a single client spreads across machines; (3) the binding is not effective for this config (namespace_id etc). Next: deploy the logging change, run 'pnpm exec wrangler tail' in one terminal and a flood in another, and read the logs. If it is only eventual consistency, document that the in-Worker limits are advisory and recommend a WAF rate-limit rule + billing alert, or reconsider a DO-free alternative. AC: root cause identified and recorded; either fixed with a regression test or PLAN section 4 and README state the real behavior.


## Notes

**2026-10-03T03:50:11Z**

Resolved as documentation (PR from fix/rate-limiter-findings). wrangler tail during a 200-request loop showed no 'rate limiter failed open' lines, so the binding does not throw. The loop may have stayed near the 60/min limit (it ran slower than planned). Decisive test: a temporary deploy with LIMIT_IP at 3 requests/10 s and 40 sequential requests gave 31x 404 and 9x 429, so the binding is attached and enforcing but admits several times the configured rate (per-machine cached counters, as Cloudflare documents). The real limits were restored afterwards. Root cause: not a bug; the binding is lenient by design. PLAN sections 4 and 7, README and VERIFY_DEPLOYMENT.md now say so, and the verify script's WARN message points at the stricter check. Backstops remain: optional WAF rate-limit rule, billing alerts. withinLimit still fails open and now logs failures (PR #7).
