---
id: rf-w0pm
status: closed
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: task
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, docs, web]
---
# Phase 1.8: Landing page and deploy-your-own docs

## Why
Visitors (and forkers) should land on a page that explains what this is, shows how to use it if an instance is already set up, and explains that they can fork and deploy their own. It must not expose any listing or upload UI (single-user tool).

## What was done
Static `packages/worker/public/index.html` (+ favicon.svg, robots.txt disallowing all) served by Workers static assets; asset requests are served by the platform without invoking the Worker, only unmatched paths (codes, /api) reach Worker code. Light/dark via prefers-color-scheme, responsive. README documents deploy-your-own (create bucket, set `UPLOAD_TOKEN`, R2 lifecycle backstop, deploy), CLI install, usage and development.

## Acceptance Criteria

- [x] Landing page renders at desktop and mobile widths (screenshots attached to PR #1).
- [x] `wrangler deploy --dry-run` bundles the Worker with all bindings resolved.
- [x] README deploy steps are accurate against wrangler's current CLI (NOT yet verified on a real account: see the "Verify on a real Cloudflare account" ticket).


## Notes

**2026-10-02T20:05:53Z**

Implemented and reviewed in PR #1 (branch feat/phase-1-worker-cli); closed as part of the epic setup.
