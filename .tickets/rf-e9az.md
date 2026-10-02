---
id: rf-e9az
status: open
deps: [rf-smnk]
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-2, macos, docs, needs-human, batch-04]
---
# Phase 2.4: macOS docs, troubleshooting and manual QA

## Why
Phase 2 is only done when someone else (or future me) can install and troubleshoot it from the docs, and when it has been verified on a real Mac.

## Design

README section "Finder integration (macOS)": install (npm install of the CLI, then `macos/install.sh`), enabling the service in System Settings, usage, uninstall, and a troubleshooting list: `r2fl: command not found` / `node: command not found` (login-shell PATH), the action missing from the Quick Actions menu (Services enablement, `pbs -flush`, log out/in), notification permission for "Script Editor"/"osascript" in System Settings -> Notifications, Gatekeeper/quarantine on downloaded workflows (`xattr -dr com.apple.quarantine`), and where config and history live. Update docs/PLAN.md phase 2 status and the README status table. Include a manual QA checklist table and record its results in a note on this ticket.

## Acceptance Criteria

- [ ] README Finder section exists with install, usage, uninstall and the troubleshooting items above.
- [ ] Manual QA checklist executed on a real Mac (macOS version recorded): single file, multiple files, filename with spaces/unicode/quotes, file over the 50 MB cap (error notification), wrong token (error notification), offline (error notification), cancel in the lifetime picker.
- [ ] docs/PLAN.md and the README status table mark phase 2 done.

