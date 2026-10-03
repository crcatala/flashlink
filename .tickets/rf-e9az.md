---
id: rf-e9az
status: in_progress
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

- [x] README Finder section exists with install, usage, uninstall and the troubleshooting items above.
- [ ] Manual QA checklist executed on a real Mac (macOS version recorded): single file, multiple files, filename with spaces/unicode/quotes, file over the 50 MB cap (error notification), wrong token (error notification), offline (error notification), cancel in the lifetime picker.
- [ ] docs/PLAN.md and the README status table mark phase 2 done.


## Notes

**2026-10-03T04:21:56Z**

Branch batch-04-macos-quick-action. README now has 'Finder integration (macOS)': install, enabling in System Settings, usage, the two actions, uninstall, troubleshooting (login-shell PATH incl. zprofile vs zshrc, missing action/pbs -flush, notification permission for Script Editor, quarantine/xattr, config/history locations) and an 11-row manual QA table. docs/PLAN.md has the Finder design and decisions. The README status table says 'built, awaiting Mac QA' and PLAN says phase 2 is built; I did NOT mark phase 2 done because that depends on QA I cannot run on Linux. AWAITING HUMAN: on a real Mac run the README 'Manual QA checklist' (rows 1-11: single file, several files, awkward names, >50 MB, wrong token, offline, cancel, 45m default, default-lifetime action, uninstall, picker in front). Record the macOS version and a pass/fail per row in a note here, fix wrapper/PATH problems found, tick criterion 2; then change the README status row and docs/PLAN.md Phase 2 to done (criterion 3) and close rf-0q8c, rf-smnk and this ticket.
