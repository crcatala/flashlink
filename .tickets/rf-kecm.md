---
id: rf-kecm
status: open
deps: [rf-og97]
links: []
created: 2026-10-03T17:14:56Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, macos, design, needs-human, swift]
---
# Design: Finder-only macOS app (Finder Sync extension + helper app), no node/PATH

The spike (rf-og97, PR #11) says VIABLE: an ad hoc signed Finder Sync extension shows 'Share via r2-fastlink' at the ROOT of Finder's context menu on macOS 26.6.2, with a 15m/1h/1d/7d submenu, and hands all selected paths plus the lifetime to a helper app via an r2fl-spike:// URL (no App Group, no profile, no team id, no prompts; 924 files and awkward names work; the host app relaunches on demand). See macos/spike/FINDINGS.md. This ticket designs the real, Finder-only app that replaces the Quick Action (macos/) as the primary Finder integration, so that it needs no node, shell or PATH. Output is a short design note approved by the owner BEFORE implementation (rf-kwsu).

## Design

Starting point: macos/spike/ (XcodeGen project, Shared/HandOff.swift, build.sh/install.sh, CI workflow .github/workflows/macos-spike.yml). Scope: extension + helper app + minimal settings (endpoint, token, default lifetime) + direct HTTP upload + clipboard + notification. Explicitly NOT in scope: history UI, menubar window, hotkey, screenshot or clipboard upload.

Upload (no CLI): POST <endpoint>/api/links, Authorization: Bearer <token>, body = file bytes streamed from disk (URLSession uploadTask(fromFile:)), Content-Length required, optional X-TTL-Seconds, X-Max-Downloads, X-Filename, Content-Type. Returns JSON with the link. See packages/worker/src/api.ts handleUpload and packages/core types. The server caps size (50 MB default) and rejects empty files; the app should pre-check using maxFileBytes.

Questions the design note must answer:
1. Token and endpoint storage: read the existing r2fl config (~/.config/r2fl/config.json, mode 600, honors XDG; one source of truth with the CLI) vs Keychain vs a settings window. The helper app is not sandboxed, so it can read the file; the sandboxed extension never needs the token.
2. History: today only the CLI writes ~/.local/share/r2fl/history.json (schema in packages/cli/src/history.ts), and r2fl ls/refresh depend on it. Should the app append to the same file so links made from Finder stay refreshable/revocable from the CLI?
3. Folders and big selections: skip, error, or zip a selected folder? Many files (924 worked in the spike): one notification summarizing, links to clipboard one per line (match r2fl behavior).
4. Lifetime: only the four fixed choices, or also the user's non-standard defaultTtl (as the Quick Action does); a 'default lifetime' item?
5. Settings UI: a minimal window vs just reading the CLI config and failing with a clear notification; first-run flow and 'not configured' errors.
6. Distribution: users build it themselves (Xcode, or the CI-built ad hoc zip + install.sh that strips quarantine). Release configuration (the spike is Debug with get-task-allow), hardened runtime, and what install/uninstall/update look like. Never commit a team id or signing identity.
7. Keep the Quick Action (macos/) as a fallback, or retire it once the app ships? Update README 'Finder integration' accordingly.
8. directoryURLs: '/' worked everywhere tried; WATCH=home was never needed. Decide whether to keep any narrowing. Folder-background menu (FIMenuKind.contextualMenuForContainer) is not implemented; decide if wanted.
9. Compatibility: only macOS 26.6.2 was tested; decide the minimum supported version (the spike targets 13.0) and how to word that.
10. Errors and progress for large uploads (notification only, or a small progress panel), and cancel.

## Acceptance Criteria

- [ ] A short design note (scope, upload/auth approach, token storage, history, distribution, tests/CI, fate of the Quick Action) is written in docs/PLAN.md or a linked doc and approved by the owner BEFORE implementation.
- [ ] rf-kwsu's scope is the approved design (done in this ticket's PR), and any new implementation tickets are split from it.
- [ ] The note records what is verified (macos/spike/FINDINGS.md) versus assumed.

