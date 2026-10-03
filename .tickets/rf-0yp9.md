---
id: rf-0yp9
status: open
deps: [rf-szpx]
links: []
created: 2026-10-03T17:27:31Z
type: task
priority: 3
assignee: cc-vps
parent: rf-yofr
tags: [phase-3, macos, batch-19]
---
# Docs, Quick Action decision and closing the macOS app epic

Make the repo describe reality after the app ships: README 'Finder integration' presents the app as the primary integration (install, update, version, uninstall, troubleshooting, what it needs and does not need); docs/PLAN.md gets the final design and drops the 'spike' wording; the Quick Action is kept as a documented fallback or retired and removed, as decided in rf-kecm; docs/AGENT_PROMPT.md batch table is current; macos/spike/ is either kept with a README banner saying it is reference only, or removed if the app fully supersedes it.

## Design

Keep macos/spike/ unless the owner says otherwise (it is the reference for CI, the hand-off format and the findings). If the Quick Action is retired: remove macos/*.workflow, install.sh, uninstall.sh, qa.sh, r2fl-quick.sh and macos.test.ts together, keep r2fl up --notify (still useful), and update every doc that mentions it. Verify all README commands run as written.

## Acceptance Criteria

- [ ] README and PLAN match the shipped app and the Quick Action decision; no stale mention of the menubar app or 'spike pending'.
- [ ] pnpm test, typecheck and format:check pass.
- [ ] rf-yofr (the epic) is closed with a short summary note.

