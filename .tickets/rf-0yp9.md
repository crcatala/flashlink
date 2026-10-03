---
id: rf-0yp9
status: open
deps: [rf-szpx]
links: []
created: 2026-10-03T17:27:31Z
type: task
priority: 4
assignee: cc-vps
parent: rf-yofr
tags: [phase-3, macos, deferred]
---
# Docs, Quick Action decision and closing the macOS app epic

**UPDATE 2026-10-03 (deferred):** PR #12 settled the engine question (rf-kecm decision 13): the Quick Action now runs a standalone r2fl binary (Bun --compile), so there is ONE code path (the TypeScript CLI) and no node/PATH dependency. The Swift client (Option A, rf-dgve) is dropped. A root-level Finder menu is still possible, but only as a thin Finder Sync shell that spawns that binary (Option B); that is deferred until the owner misses the root-level menu after living with the Quick Action. This ticket stays open for that case and its batch tag was removed so the batch picker does not start it. The real next step is binary distribution: rf-kphq. The 'Quick Action decision' below is made: the Quick Action stays the primary Finder integration.

Make the repo describe reality after the app ships: README 'Finder integration' presents the app as the primary integration (install, update, version, uninstall, troubleshooting, what it needs and does not need); docs/PLAN.md gets the final design and drops the 'spike' wording; the Quick Action is kept as a documented fallback or retired and removed, as decided in rf-kecm; docs/AGENT_PROMPT.md batch table is current; macos/spike/ is either kept with a README banner saying it is reference only, or removed if the app fully supersedes it.

## Design

Keep macos/spike/ unless the owner says otherwise (it is the reference for CI, the hand-off format and the findings). If the Quick Action is retired: remove macos/*.workflow, install.sh, uninstall.sh, qa.sh, r2fl-quick.sh and macos.test.ts together, keep r2fl up --notify (still useful), and update every doc that mentions it. Verify all README commands run as written.

## Acceptance Criteria

- [ ] README and PLAN match the shipped app and the Quick Action decision; no stale mention of the menubar app or 'spike pending'.
- [ ] pnpm test, typecheck and format:check pass.
- [ ] rf-yofr (the epic) is closed with a short summary note.

