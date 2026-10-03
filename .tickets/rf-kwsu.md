---
id: rf-kwsu
status: open
deps: [rf-e9az, rf-kecm, rf-dgve]
links: []
created: 2026-10-02T20:05:54Z
type: feature
priority: 2
assignee: cc-vps
parent: rf-yofr  # Epic: native Finder-only macOS app
tags: [phase-3, macos, swift, needs-human, batch-16]
---
# Finder-only macOS app: Finder Sync extension + helper app (implementation)

## Why
Rescoped after the rf-og97 spike (PR #11) returned VIABLE: a locally signed (ad hoc) Finder Sync extension shows a root-level 'Share via r2-fastlink' menu with a lifetime submenu and hands the selection to a helper app, with no node, shell or PATH dependency, no paid Apple account and no prompts (macOS 26.6.2). The owner wants Finder integration only. This ticket was previously a SwiftUI menubar app (drop target, hotkey, history window, per-row refresh/revoke); that scope is dropped.

## Design
Do NOT start before the design ticket rf-kecm is approved. Starting point is macos/spike/ (see macos/spike/FINDINGS.md): a sandboxed com.apple.FinderSync extension plus an LSUIElement helper app, hand-off by percent-encoded URL scheme, built with XcodeGen + xcodebuild locally or by the macOS CI job. The helper app uploads directly over HTTP (POST <endpoint>/api/links, Bearer token, file bytes, Content-Length, X-TTL-Seconds / X-Filename), copies the link(s) to the clipboard and posts a notification. Minimal settings only: endpoint, token, default lifetime. Out of scope: history UI, menubar window, global hotkey, screenshot or clipboard upload.

## Scope split (epic rf-yofr)
The upload logic (config, durations, streaming upload, error mapping, hand-off format) lives in the Foundation-only package macos/R2FLCore (rf-dgve) and is already tested when this ticket starts. This ticket is the Apple-only shell: the Finder Sync extension, the LSUIElement helper app, settings/first-run, clipboard, notification text, the app icon asset, a Release build configuration, and a macOS CI job (extend .github/workflows/macos-spike.yml or add macos-app.yml; macos-latest, path-filtered, with timeouts; Ubicloud has no macOS runners).

## Acceptance Criteria

- [ ] rf-kecm's design note is approved by the owner BEFORE implementation.
- [ ] The app builds in CI on macOS (Release configuration, ad hoc signed, zip uploaded as an artifact), never stores the token outside the approved location, uploads straight to the Worker (no CLI dependency), and has a manual QA checklist recorded on a real Mac.
- [ ] README 'Finder integration' and docs/PLAN.md describe the app; the Quick Action's status (fallback or retired) is stated.
