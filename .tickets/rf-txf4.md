---
id: rf-txf4
status: open
deps: [rf-kwsu]
links: []
created: 2026-10-03T17:27:31Z
type: task
priority: 4
assignee: cc-vps
parent: rf-yofr
tags: [phase-3, macos, idea, needs-human, deferred]
---
# Final app icon (optional): replace the interim favicon-based icon

**UPDATE 2026-10-03 (deferred):** PR #12 settled the engine question (rf-kecm decision 13): the Quick Action now runs a standalone r2fl binary (Bun --compile), so there is ONE code path (the TypeScript CLI) and no node/PATH dependency. The Swift client (Option A, rf-dgve) is dropped. A root-level Finder menu is still possible, but only as a thin Finder Sync shell that spawns that binary (Option B); that is deferred until the owner misses the root-level menu after living with the Quick Action. This ticket stays open for that case and its batch tag was removed so the batch picker does not start it. The real next step is binary distribution: rf-kphq.

The app uses an interim icon derived from the landing page favicon (macos/spike/App/AppIcon.svg, rendered by macos/spike/tools/make-icon.mjs). If the owner wants a designed icon: generate or supply artwork, check how it renders on macOS 26 (non-Icon-Composer icons may be wrapped in a plate; consider an Icon Composer .icon), and update the asset catalog. Idea only: the agent asks before starting.

## Acceptance Criteria

- [ ] Owner approves the artwork; notifications and the Finder/Extensions settings show it correctly on macOS 26.
- [ ] Source artwork and the regeneration steps are committed.

