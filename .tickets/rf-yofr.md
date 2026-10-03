---
id: rf-yofr
status: open
deps: []
links: []
created: 2026-10-03T17:27:05Z
type: epic
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [epic, phase-3, macos]
---
# Epic: native Finder-only macOS app (Finder Sync extension + helper app)

WHY: the Finder Quick Action (macos/, PR #10) depends on a shell finding r2fl and node on PATH, lives in the Quick Actions submenu and asks the lifetime in a separate dialog. The spike rf-og97 (PR #11, VIABLE on macOS 26.6.2) proved a locally signed (ad hoc) Finder Sync extension can put 'Share via r2-fastlink >  15 minutes | 1 hour | 1 day | 7 days' at the ROOT of Finder's right-click menu and hand the selection to a helper app, with no paid Apple account and no prompts. This epic turns that into the real, Finder-only integration that uploads straight to the Worker's HTTP API (no CLI, no node, no PATH), copies the link and posts a notification.

GOALS: root-level Finder menu; direct HTTP upload; clipboard + notification titled 'r2-fastlink' with an app icon; minimal settings (endpoint, token, default lifetime); people build it themselves or install a CI-built ad hoc zip, never a notarized binary; self-serve (not automatic) updates with a visible version.
NON-GOALS: history UI, menubar window, global hotkey, screenshot or clipboard upload, Windows/Linux, a paid Apple Developer account, notarization.

START HERE: macos/spike/FINDINGS.md (what is proven and the caveats), macos/spike/README.md, docs/PLAN.md section 'Finder Sync spike', .github/workflows/macos-spike.yml. The upload API is packages/worker/src/api.ts handleUpload; types in packages/core/src/types.ts; config in packages/cli/src/config.ts; history in packages/cli/src/history.ts. The repo-wide invariants in rf-dek6 still apply.

ORDER (each child depends on the previous; do not skip ahead):
1. rf-kecm  Design note, approved by the owner. (batch-14)
2. rf-dgve  Swift upload core: Foundation-only SwiftPM package, tested on Linux CI. (batch-15)
3. rf-kwsu  App shell: extension + helper app wired to the core, settings, clipboard, notification, macOS CI. (batch-16)
4. rf-16ho  Releases and self-serve updates via GitHub Releases. (batch-17)
5. rf-szpx  Mac QA and sign-off (human). (batch-18)
6. rf-0yp9  Docs, Quick Action decision, close the epic. (batch-19)
7. rf-txf4  Final app icon (optional idea). (batch-20)

HUMAN STEPS: 1 (approval), 3 and 5 (a real Mac), 7 (design taste). Everything else can be done by an agent on Linux plus the macOS CI job (the only non-Ubicloud runner, macos-latest, by design: Ubicloud has no macOS).

DONE WHEN: all children are closed and the README describes the app as the primary Finder integration.

