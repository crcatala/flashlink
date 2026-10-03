---
id: rf-szpx
status: open
deps: [rf-kwsu, rf-16ho]
links: []
created: 2026-10-03T17:27:31Z
type: task
priority: 4
assignee: cc-vps
parent: rf-yofr
tags: [phase-3, macos, needs-human, deferred]
---
# Mac QA and sign-off for the Finder-only app (human, on a real Mac)

**UPDATE 2026-10-03 (deferred):** PR #12 settled the engine question (rf-kecm decision 13): the Quick Action now runs a standalone r2fl binary (Bun --compile), so there is ONE code path (the TypeScript CLI) and no node/PATH dependency. The Swift client (Option A, rf-dgve) is dropped. A root-level Finder menu is still possible, but only as a thin Finder Sync shell that spawns that binary (Option B); that is deferred until the owner misses the root-level menu after living with the Quick Action. This ticket stays open for that case and its batch tag was removed so the batch picker does not start it. The real next step is binary distribution: rf-kphq.

Run the released/CI-built app end to end on the owner's Mac and record the result. Runs by hand with the owner; an agent prepares the checklist and script, the owner executes the Finder steps. Needs the app shell (rf-kwsu) and the release flow (rf-16ho) done.

## Design

Install from the CI/Release zip with install.sh (no Xcode needed). Checklist to write at macos/QA.md and record results in the ticket: first run with NO config (clear 'not configured' notification, no crash); configured run: one file, several files, 200+ files, awkward names (spaces, quotes, unicode/emoji, leading dash), all four lifetimes with the real expiry verified against the link, link on the clipboard, notification title 'r2-fastlink' and the app icon; error cases: wrong token, offline, over the size cap, empty file, a folder; the menu in Desktop, Documents, Downloads, a subfolder, an external drive, a network volume; logout/login; in-place update from release N to N+1 (permission prompts, extension still enabled); uninstall leaves no menu item and no background process. Compare with the Quick Action on the same files. Record macOS version and Mac type.

## Acceptance Criteria

- [ ] macos/QA.md exists with the checklist and a results table filled in by the owner on a real Mac (macOS version recorded).
- [ ] Every failure found has a follow-up ticket or a fix before sign-off.
- [ ] The owner says 'approved' in a note on this ticket.

