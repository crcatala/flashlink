---
id: rf-kecm
status: open
deps: [rf-og97]
links: []
created: 2026-10-03T17:14:56Z
type: task
priority: 4
assignee: cc-vps
parent: rf-yofr  # Epic: native Finder-only macOS app
tags: [phase-3, macos, design, needs-human, swift, deferred]
---
# Design: Finder-only macOS app (Finder Sync extension + helper app), no node/PATH

**UPDATE 2026-10-03 (deferred):** PR #12 settled the engine question (rf-kecm decision 13): the Quick Action now runs a standalone r2fl binary (Bun --compile), so there is ONE code path (the TypeScript CLI) and no node/PATH dependency. The Swift client (Option A, rf-dgve) is dropped. A root-level Finder menu is still possible, but only as a thin Finder Sync shell that spawns that binary (Option B); that is deferred until the owner misses the root-level menu after living with the Quick Action. This ticket stays open for that case and its batch tag was removed so the batch picker does not start it. The real next step is binary distribution: rf-kphq.

**Decision 13 (made): Option B.** One code path, by compiling the CLI (Bun) and calling it by absolute path with `--json`. Rationale and measured sizes (darwin-arm64 about 60 MB, darwin-x64 about 66 MB, `--version` in about 70 ms): docs/PLAN.md, 'Standalone binary (prototype)', and PR #12. Node single-executable applications were tried and rejected there. The CLI features (secret warning rf-chq2, clipboard rf-4514, folder zip rf-gah1) therefore reach the Quick Action, and any future app, automatically; no per-feature parity decision is needed.

The spike (rf-og97, PR #11) says VIABLE: an ad hoc signed Finder Sync extension shows 'Share via r2-fastlink' at the ROOT of Finder's context menu on macOS 26.6.2, with a 15m/1h/1d/7d submenu, and hands all selected paths plus the lifetime to a helper app via an r2fl-spike:// URL (no App Group, no profile, no team id, no prompts; 924 files and awkward names work; the host app relaunches on demand). See macos/spike/FINDINGS.md. This ticket designs the real, Finder-only app that replaces the Quick Action (macos/) as the primary Finder integration, so that it needs no node, shell or PATH. Output is a short design note (a new section in docs/PLAN.md) approved by the owner BEFORE implementation. An agent drafts it; the owner approves (put 'AWAITING HUMAN:' in a note when the draft is ready). Epic: rf-yofr.

## Design

Starting point: macos/spike/ (XcodeGen project, Shared/HandOff.swift, build.sh/install.sh, CI workflow .github/workflows/macos-spike.yml). Scope: extension + helper app + minimal settings (endpoint, token, default lifetime) + direct HTTP upload + clipboard + notification. Explicitly NOT in scope: history UI, menubar window, hotkey, screenshot or clipboard upload.

Upload (SUPERSEDED by decision 13: the helper spawns the standalone binary `r2fl up --json` instead of a Swift upload; the notes below describe the HTTP API the binary uses): POST <endpoint>/api/links, Authorization: Bearer <token>, body = file bytes streamed from disk (URLSession uploadTask(fromFile:)), Content-Length required, optional X-TTL-Seconds, X-Max-Downloads, X-Filename, Content-Type. Returns JSON with the link. See packages/worker/src/api.ts handleUpload and packages/core types. The server caps size (50 MB default) and rejects empty files; the app should pre-check using maxFileBytes.

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
11. Icon: notifications show the app icon. An interim icon (the landing page favicon in the macOS icon grid) lives in macos/spike/App/Assets.xcassets; decide whether to keep it, and the macOS 26 icon format (Icon Composer) question.
13. One code path or two? DECIDED 2026-10-03: Option B, the CLI compiled to a standalone binary, called by absolute path with --json (PR #12). The Swift reimplementation (Option A, macos/R2FLCore) is dropped; rf-dgve is closed.
12. Versioning, releases and self-serve updates: see `rf-16ho`; the design note must say how the app reports its version.

## Acceptance Criteria

- [ ] A short design note (scope, upload/auth approach, token storage, history, distribution, tests/CI, fate of the Quick Action) is written in docs/PLAN.md or a linked doc and approved by the owner BEFORE implementation.
- [ ] The child tickets of the epic rf-yofr (core rf-dgve, app shell rf-kwsu, releases rf-16ho, QA rf-szpx, docs rf-0yp9, icon rf-txf4) are each confirmed or amended by the note (scope, order, acceptance), in this ticket's PR. The note ends with a one-line decision for each of the twelve questions above.
- [ ] The note records what is verified (macos/spike/FINDINGS.md) versus assumed.


## Notes

**2026-10-03T19:49:38Z**

2026-10-03: decision 13 made (Option B, standalone binary, PR #12). Epic rf-yofr deferred; rf-dgve closed; binary distribution is rf-kphq. See the banner at the top of this ticket.
