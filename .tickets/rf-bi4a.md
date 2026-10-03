---
id: rf-bi4a
status: open
deps: []
links: []
created: 2026-10-03T04:02:02Z
type: task
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, verification, cost, needs-human]
---
# Check DO/Worker/R2 usage about a day after real use and compare with PLAN section 5

Split out of rf-rxkx (checklist item 9, usage half) so rf-rxkx could close. The deployment has been in real use since 2026-10-03 (verification runs, manual tests). Wait until it has run for about a day of normal use, then compare the Cloudflare dashboard with docs/PLAN.md section 5 (cost model): Durable Object requests (expect about 1 per fetch of a live link, 2 per upload, 1 per API call, plus 1 per sweeper alarm; the first 24 h showed 299 requests and 0 errors, mostly scripted), DO duration in GB-s (expect near zero while idle; a steadily climbing value means something keeps the Registry awake), rows written (a handful per upload and per alarm), and Worker requests and R2 operations vs what you actually did. Dashboard locations: Workers & Pages > Durable Objects > r2-fastlink_Registry (metrics), and the Worker's Metrics tab, plus R2 > r2-fastlink > Metrics. Also optional, from rf-rxkx item 8: attach a custom domain, set PUBLIC_BASE_URL, redeploy and re-run the verify script. This ticket blocks rf-l2ym (edge cache), which only makes sense with real usage numbers.

## Acceptance Criteria

- [ ] Dashboard usage after about a day recorded in a note and compared with PLAN section 5 (numbers per metric above).
- [ ] docs/PLAN.md section 5 updated if the real numbers differ from the model, or a note says they match.
- [ ] (Optional) custom domain check done or explicitly skipped, noted here.

