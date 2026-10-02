---
id: rf-j60m
status: open
deps: []
links: []
created: 2026-10-02T20:05:54Z
type: feature
priority: 4
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, cli, worker, idea]
---
# Multi-machine history: decide on export/import or opt-in remote listing

## Why
History is local-only by design, so each machine (for example the owner's Mac and a Linux dev container) has its own view, and `r2fl ls` on one machine cannot show links made on another. Probably fine, but worth revisiting if it proves annoying.

## Design

Be careful: the server currently has NO listing endpoint, which keeps the public/API surface minimal (docs/PLAN.md section 3). Options: (a) do nothing; (b) opt-in `GET /api/links` (authenticated, paginated, metadata only) behind a Worker var, used by `r2fl ls --remote`; (c) export/import of history.json between machines. Prefer (c) or (b) with the var defaulting off. Any server listing must read from the single DO with a bounded query (LIMIT, indexed by created_at) and respect the cost invariants.

## Acceptance Criteria

- [ ] A decision (do nothing / export-import / opt-in remote listing) is recorded with rationale in a note and docs/PLAN.md.
- [ ] If implemented: default behavior unchanged (no new public surface unless enabled), tests for pagination/auth, README updated.

