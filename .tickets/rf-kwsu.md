---
id: rf-kwsu
status: open
deps: [rf-e9az]
links: []
created: 2026-10-02T20:05:54Z
type: feature
priority: 4
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, macos, idea, needs-human, batch-14]
---
# Native macOS menubar app (SwiftUI) - design first

## Why
After the Quick Action proves the workflow, a native menubar app could add a drop target, a global hotkey, a visible history, and one-click refresh/revoke. The plan intentionally defers this: "native Swift menubar bar not yet".

## Design

SwiftUI MenuBarExtra app in `macos/App/` that shells out to the existing `r2fl` binary (no reimplementation of the API) and reads the same `history.json` (schema in packages/cli/src/history.ts) and config. Features: drag-and-drop onto the menu bar icon, global hotkey to upload the clipboard/screenshot, list of recent links with status (live/expired/exhausted) and per-row copy/refresh/revoke. Needs Xcode, code signing and notarization decisions from the owner; this is a separate effort and should get its own sub-plan before any code. Do not start before phase 2 is verified on a real Mac.

## Acceptance Criteria

- [ ] A short design note (scope, signing/notarization approach, distribution) is approved by the owner BEFORE implementation.
- [ ] If implemented: app builds in CI on macOS, never stores the token outside the existing config file, and has a manual QA checklist recorded.

