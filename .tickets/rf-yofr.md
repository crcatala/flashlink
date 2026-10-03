---
id: rf-yofr
status: open
deps: []
links: []
created: 2026-10-03T17:27:05Z
type: epic
priority: 4
assignee: cc-vps
parent: rf-dek6
tags: [epic, phase-3, macos, deferred]
---
# Epic: native Finder-only macOS app (Finder Sync extension + helper app)

> `macos/spike/` is not on `main`: it lives at the git tag `spike-finder-sync` (PR #11, closed unmerged). Findings: docs/finder-sync-spike.md.

**UPDATE 2026-10-03 (deferred):** PR #12 settled the engine question (rf-kecm decision 13): the Quick Action now runs a standalone r2fl binary (Bun --compile), so there is ONE code path (the TypeScript CLI) and no node/PATH dependency. The Swift client (Option A, rf-dgve) is dropped. A root-level Finder menu is still possible, but only as a thin Finder Sync shell that spawns that binary (Option B); that is deferred until the owner misses the root-level menu after living with the Quick Action. This ticket stays open for that case and its batch tag was removed so the batch picker does not start it. The real next step is binary distribution: rf-kphq.

WHY: the Finder Quick Action (macos/, PR #10) depends on a shell finding r2fl and node on PATH, lives in the Quick Actions submenu and asks the lifetime in a separate dialog. The spike rf-og97 (PR #11, VIABLE on macOS 26.6.2) proved a locally signed (ad hoc) Finder Sync extension can put 'Share via r2-fastlink >  15 minutes | 1 hour | 1 day | 7 days' at the ROOT of Finder's right-click menu and hand the selection to a helper app, with no paid Apple account and no prompts. This epic turns that into the real, Finder-only integration that uploads straight to the Worker's HTTP API (no CLI, no node, no PATH), copies the link and posts a notification.

GOALS: root-level Finder menu; direct HTTP upload; clipboard + notification titled 'r2-fastlink' with an app icon; minimal settings (endpoint, token, default lifetime); people build it themselves or install a CI-built ad hoc zip, never a notarized binary; self-serve (not automatic) updates with a visible version.
NON-GOALS: history UI, menubar window, global hotkey, screenshot or clipboard upload, Windows/Linux, a paid Apple Developer account, notarization.

START HERE: docs/finder-sync-spike.md (what is proven and the caveats), macos/spike/README.md, docs/PLAN.md section 'Finder Sync spike', .github/workflows/macos-spike.yml (on the tag). The upload API is packages/worker/src/api.ts handleUpload; types in packages/core/src/types.ts; config in packages/cli/src/config.ts; history in packages/cli/src/history.ts. The repo-wide invariants in rf-dek6 still apply.

ORDER (each child depends on the previous; do not skip ahead):
1. rf-kecm  Design note, approved by the owner.
2. rf-dgve  DROPPED (closed): Swift client replaced by the standalone binary (PR #12).
3. rf-kwsu  App shell: extension + helper app that spawns the standalone r2fl binary, clipboard, notification, macOS CI.
4. rf-16ho  Releases and self-serve updates via GitHub Releases.
5. rf-szpx  Mac QA and sign-off (human).
6. rf-0yp9  Docs, Quick Action decision, close the epic.
7. rf-txf4  Final app icon (optional idea).

HUMAN STEPS: 1 (approval), 3 and 5 (a real Mac), 7 (design taste). Everything else can be done by an agent on Linux plus the macOS CI job (the only non-Ubicloud runner, macos-latest, by design: Ubicloud has no macOS).

DONE WHEN: all children are closed and the README describes the app as the primary Finder integration.


## Notes

**2026-10-03T19:49:38Z**

2026-10-03: epic deferred (see banner). Children kecm/kwsu/16ho/szpx/0yp9/txf4 lowered to P4 with batch tags removed; rf-dgve closed; new next step rf-kphq.
