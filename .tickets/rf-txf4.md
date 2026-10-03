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
tags: [phase-3, macos, idea, needs-human, batch-20]
---
# Final app icon (optional): replace the interim favicon-based icon

The app uses an interim icon derived from the landing page favicon (macos/spike/App/AppIcon.svg, rendered by macos/spike/tools/make-icon.mjs). If the owner wants a designed icon: generate or supply artwork, check how it renders on macOS 26 (non-Icon-Composer icons may be wrapped in a plate; consider an Icon Composer .icon), and update the asset catalog. Idea only: the agent asks before starting.

## Acceptance Criteria

- [ ] Owner approves the artwork; notifications and the Finder/Extensions settings show it correctly on macOS 26.
- [ ] Source artwork and the regeneration steps are committed.

