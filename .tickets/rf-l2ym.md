---
id: rf-l2ym
status: open
deps: [rf-rxkx, rf-dd4u, rf-bi4a]
links: []
created: 2026-10-02T20:05:53Z
type: feature
priority: 4
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, worker, idea, cost, batch-12]
---
# Optional edge cache for positive link lookups (only if measurements justify)

## Why
Every fetch costs one Durable Object request. For a widely re-fetched link that is wasteful, but it is cheap at personal scale ($0.15 per million beyond the included amount). Only worth doing if real usage data from the verified deployment shows it matters.

## Design

Use the Workers Cache API (`caches.default`) to cache the POSITIVE resolve result (code -> r2 key, content type, size, filename, expiry) for min(remaining lifetime, 30s). Revoke/refresh/purge then lag by up to 30s on cached colos; if that is unacceptable, purge the cache entry in the same request that mutates (only effective in the colo that handled it). Hit counting and download caps must still be exact: either bypass the cache when `max_downloads` is set or keep counting via a cheap alternative; decide carefully because this interacts with the download-cap policy ticket. Must keep Cache-Control: no-store on the client-facing response (the cache is Worker-internal).
Only start after measuring real DO request volume in the verification ticket's usage review.

## Acceptance Criteria

- [ ] Measured DO request volume justifies the change (recorded in a note with numbers).
- [ ] Revoke/expiry semantics bounded and documented (maximum staleness stated in docs/PLAN.md and README); links with a download cap are never over-served.
- [ ] Tests prove: cached hits skip the registry; expiry is honored at the cached expiry; revoke visible within the documented bound; client responses stay no-store.

