---
id: rf-kwsu
status: open
deps: [rf-e9az, rf-kecm, rf-kphq]
links: []
created: 2026-10-02T20:05:54Z
type: feature
priority: 4
assignee: cc-vps
parent: rf-yofr  # Epic: native Finder-only macOS app
tags: [phase-3, macos, swift, needs-human, deferred]
---
# Finder-only macOS app: Finder Sync extension + helper app (implementation)

> `macos/spike/` is not on `main`: it lives at the git tag `spike-finder-sync` (PR #11, closed unmerged). Findings: docs/finder-sync-spike.md.

**UPDATE 2026-10-03 (deferred):** PR #12 settled the engine question (rf-kecm decision 13): the Quick Action now runs a standalone r2fl binary (Bun --compile), so there is ONE code path (the TypeScript CLI) and no node/PATH dependency. The Swift client (Option A, rf-dgve) is dropped. A root-level Finder menu is still possible, but only as a thin Finder Sync shell that spawns that binary (Option B); that is deferred until the owner misses the root-level menu after living with the Quick Action. This ticket stays open for that case and its batch tag was removed so the batch picker does not start it. The real next step is binary distribution: rf-kphq.

## Why
Rescoped after the rf-og97 spike (PR #11) returned VIABLE: a locally signed (ad hoc) Finder Sync extension shows a root-level 'Share via r2-fastlink' menu with a lifetime submenu and hands the selection to a helper app, with no node, shell or PATH dependency, no paid Apple account and no prompts (macOS 26.6.2). The owner wants Finder integration only. This ticket was previously a SwiftUI menubar app (drop target, hotkey, history window, per-row refresh/revoke); that scope is dropped.

## Design
Do NOT start before the design ticket rf-kecm is approved. Starting point is macos/spike/ (see docs/finder-sync-spike.md): a sandboxed com.apple.FinderSync extension plus an LSUIElement helper app, hand-off by percent-encoded URL scheme, built with XcodeGen + xcodebuild locally or by the macOS CI job. (Superseded: the helper spawns the standalone r2fl binary instead of uploading itself. The API it uses: POST <endpoint>/api/links, Bearer token, file bytes, Content-Length, X-TTL-Seconds / X-Filename), copies the link(s) to the clipboard and posts a notification. Minimal settings only: endpoint, token, default lifetime. Out of scope: history UI, menubar window, global hotkey, screenshot or clipboard upload.

## Scope split (epic rf-yofr)
Upload, config, durations and error mapping stay in the TypeScript CLI, shipped as the standalone binary (rf-kphq); the helper app calls it with `r2fl up --json --notify`-style arguments. This ticket is the Apple-only shell: the Finder Sync extension, the LSUIElement helper app, clipboard/notification text, the app icon asset, a Release build configuration, and a macOS CI job (extend .github/workflows/macos-spike.yml (on the tag) or add macos-app.yml; macos-latest, path-filtered, with timeouts; Ubicloud has no macOS runners).

## Acceptance Criteria

- [ ] rf-kecm's design note is approved by the owner BEFORE implementation.
- [ ] The app builds in CI on macOS (Release configuration, ad hoc signed, zip uploaded as an artifact), never stores the token outside the approved location, uploads straight to the Worker (no CLI dependency), and has a manual QA checklist recorded on a real Mac.
- [ ] README 'Finder integration' and docs/PLAN.md describe the app; the Quick Action's status (fallback or retired) is stated.
