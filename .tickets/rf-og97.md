---
id: rf-og97
status: closed
deps: []
links: [rf-0q8c]
created: 2026-10-03T14:27:41Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, macos, spike, needs-human, swift]
---
# Spike: can a locally-signed Finder Sync extension add a root 'Share via r2-fastlink' menu on my Mac?

## Why
The Automator Quick Action shipped in PR #10 (rf-0q8c, rf-smnk, rf-e9az) works only if a bare login shell can find `r2fl` and `node`. Mac QA showed that is fragile: with mise, `r2fl` lives in a per-version folder that a Quick Action's minimal PATH never sees, and many setups put PATH only in ~/.zshrc. It also lives in the Finder right-click "Quick Actions" submenu and asks for the lifetime in a separate dialog.

The owner wants Finder integration that is as native as possible and does not depend on node/shell/PATH. The only way to add an item at the ROOT of Finder's context menu (not in the Quick Actions submenu) is a Finder Sync extension (the mechanism Dropbox and Nextcloud use). It could offer a submenu directly in the right-click menu:

    Share via r2-fastlink >  15 minutes | 1 hour | 1 day | 7 days

and a small background app could upload straight to the Worker's HTTP API (no CLI). This repo is open source people build and run themselves (never distributed as signed binaries), so the question is whether this works with LOCAL signing only.

## Purpose of this ticket
A throwaway SPIKE to answer one question cheaply before any design work: does a Finder Sync extension, built in Xcode on the owner's Mac with local/personal signing only (no paid Apple Developer account, no notarization), load, show a root-level menu item with a lifetime submenu, and hand the selected files to a helper app? It does NOT upload anything. If it fails, we fall back to the Quick Action (PR #10) or an Apple Shortcut. If it works, a follow-up ticket designs the real Finder-only app and rewrites rf-kwsu around that smaller scope.

## Context for the agent (read first)
- Run this on the owner's Mac, interactively with them. The owner's Mac is where it is built and tested; Linux agents cannot do this. Ask for the macOS and Xcode versions up front and record them.
- Read docs/PLAN.md section 2 (architecture), the "macOS Quick Action" bullet under the CLI section, and the "Finder integration" section in README.md for the current approach and its limits.
- Upload API (for the later real app, NOT needed in the spike): `POST <endpoint>/api/links` with `Authorization: Bearer <token>`, the file bytes as the body, `Content-Length` required, optional headers `X-TTL-Seconds`, `X-Max-Downloads`, `X-Filename`, `Content-Type`. Returns JSON with the link. See packages/worker/src/api.ts (handleUpload) and packages/core for the types.
- Not a goal: history, menubar UI, hotkey, screenshots, clipboard upload. The owner only wants the Finder integration.
- Do not commit signing identities, team IDs, profiles or tokens.

## Design (suggested, adapt as needed)
- Put the spike under `macos/spike/` (or a branch that is easy to delete). Prefer a project that can be built from the command line (`xcodebuild`, or an XcodeGen `project.yml` checked in) so others can reproduce it; a plain .xcodeproj is fine if that is simpler.
- Targets: (1) a host app with `LSUIElement` (no Dock icon) that registers a URL scheme such as `r2fl-spike://share?ttl=1h` plus file paths (or any other hand-off that does not need App Groups or a provisioning profile), and (2) a Finder Sync extension (`com.apple.FinderSync`) whose `menu(for:)` returns a "Share via r2-fastlink" item with a submenu of lifetimes.
- Set `FIFinderSyncController.default().directoryURLs` to cover everything the user can right-click (try `/`, or the home folder plus mounted volumes, and record what works).
- On click the extension passes the selected `FIFinderSyncController.default().selectedItemURLs()` and the chosen lifetime to the host app. The host app only posts a user notification ("would share N file(s) for 1h: <names>") to prove the hand-off and that notifications from the app work when ad-hoc signed.
- Avoid entitlements that need a provisioning profile (App Groups etc.). The extension must be sandboxed; the host app need not be.
- Sign with "Sign to Run Locally" (ad hoc) first. Only if that fails, try a free personal Apple ID team, and record exactly what is required.

## Acceptance Criteria
- [ ] macOS version, Xcode version and the signing mode that worked (ad hoc / personal team) are recorded in a note.
- [ ] The project builds and runs on the owner's Mac with local signing only; the exact build/run steps are written down (a short README in the spike folder).
- [ ] After enabling the extension (System Settings -> Privacy & Security -> Extensions -> Finder, or wherever the current macOS keeps it), right-clicking a file in Finder shows "Share via r2-fastlink" with the lifetime submenu at the ROOT of the context menu, not inside Quick Actions. A screenshot is attached or described.
- [ ] Right-clicking works in at least: Desktop, Documents, Downloads, a subfolder, and an external or network volume if available. Record which locations get the menu and which do not (this decides what directoryURLs must be).
- [ ] Clicking a lifetime with one file, then with several selected files, results in the host app receiving ALL the file paths and the chosen lifetime and posting a notification from "r2-fastlink" (not Script Editor).
- [ ] File names with spaces, quotes, unicode and a leading dash arrive intact.
- [ ] Record how the extension survives a logout/login and a rebuild (does it need `pluginkit` commands or `killall Finder`?), and whether macOS shows any Gatekeeper or privacy prompts (Files and Folders access for Desktop/Documents/Downloads).
- [ ] A clear verdict note: VIABLE / VIABLE WITH CAVEATS (list them) / NOT VIABLE (with the error messages or evidence), and a recommendation for the next step (design the real app; or stay with the Quick Action; or try an Apple Shortcut).
- [ ] If viable: file a follow-up design ticket for the Finder-only app (scope: extension + helper app + minimal settings for endpoint/token/default lifetime, Keychain or r2fl config for the token, direct HTTP upload, clipboard, notification) and adjust rf-kwsu's scope accordingly. Otherwise close this ticket with the findings.

## Notes for the repo conventions
- This ticket intentionally has no `batch-NN` tag so the automated batch picker does not take it; it is run by hand with a fresh agent on the owner's Mac.
- Any code that stays in the repo needs README/PLAN updates per the epic's invariants; a pure spike that is deleted afterwards only needs the findings recorded in a note here and, if useful, a short paragraph in docs/PLAN.md.


**2026-10-03T15:16:45Z**

Linux-side work done on branch spike/rf-og97-finder-sync (PR pending). Written and checked without a Mac:
- macos/spike/: XcodeGen project (host app + sandboxed Finder Sync extension), run.sh (ad hoc build, install, pluginkit enable), test-handoff.sh, README (Mac test script), FINDINGS.md template.
- Verified on Linux: HandOff.swift compiles and passes SelfTest with swiftc 6.1.2; the app and extension sources parse and typecheck only against hand-written stubs (NOT against AppKit/FinderSync, never built by Xcode); plists parse; shell encoder agrees with the Swift parser; vitest macos-spike.test.ts.
- NOT done (needs the Mac): every acceptance criterion. Ticket stays open; fill macos/spike/FINDINGS.md on the Mac.

**2026-10-03T16:50:22Z**

CI Mac result (GitHub macos-latest, macOS 26.6.2, Xcode 26.6, run 37138241482 on PR #11): both targets build ad hoc signed first try; extension is sandboxed with app-sandbox + user-selected.read-only; pluginkit -a/-e use registers it and lists it enabled (+); host app launches, URL scheme works, test-handoff.sh passes 6/6 awkward names. Notifications and the Finder menu NOT exercised (no Finder session on CI). Remaining for the owner's Mac: download the CI artifact (README Option A, no Xcode needed) and run the Finder steps in macos/spike/README.md.

**2026-10-03T17:15:37Z**

Mac run done by the owner on macOS 26.6.2 (CI-built ad hoc app): VIABLE. Root-level menu + lifetime submenu works with ad hoc signing only; all paths/awkward names/924 files and all four lifetimes arrive; notification titled r2-fastlink; no prompts; no killall needed; host app relaunches on click. Details: macos/spike/FINDINGS.md, screenshots in a PR #11 comment. Follow-up design ticket rf-kecm filed; rf-kwsu rescoped to a Finder-only app and now depends on rf-kecm. Left OPEN until the owner confirms closing (PR #11 merge).

**2026-10-03T17:19:08Z**

Closed after the owner's OK (macOS 26.6.2 run: VIABLE, see macos/spike/FINDINGS.md). The spike folder is kept as the reference for the real app (rf-kecm, rf-kwsu).
