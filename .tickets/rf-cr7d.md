---
id: rf-cr7d
status: open
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, docs, needs-human, batch-10]
---
# Choose and add a license (owner decision)

## Why
The repo is meant to go public so others can fork and deploy it. README.md currently says "To be decided before the repo goes public." This needs the OWNER's decision (do not choose for them).

## Design

Present the owner with a short comparison (MIT: maximal reuse, no patent grant; Apache-2.0: adds patent grant; others only if they ask), get a decision, then: add `LICENSE` with the correct year/holder, add `"license"` to every package.json (root, core, worker, cli), update the README License section, and check that no bundled dependency license is incompatible.

## Acceptance Criteria

- [ ] Owner has explicitly chosen a license (record the decision in a ticket note).
- [ ] LICENSE file present; `license` field set in all package.json files; README License section updated.
- [ ] `pnpm format:check` still clean.

