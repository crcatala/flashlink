---
id: rf-smnk
status: in_progress
deps: [rf-0q8c]
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-2, macos, batch-04]
---
# Phase 2.3: Quick Action lifetime picker (and no-prompt variant)

## Why
The default 1h lifetime is right most of the time, but the whole point of per-share expiry is choosing a different one (15 minutes for something sensitive, a day for something a teammate will pick up tomorrow). From Finder there is no flag to pass, so the Quick Action needs a quick way to pick the lifetime, with the configured default preselected so the common case is one click.

## Design

- In the wrapper (macos/r2fl-quick.sh) show `osascript -e 'choose from list {"15 minutes","1 hour","1 day","7 days"} with prompt "Link lifetime" default items {"<configured default>"}'` and translate the selection to `--ttl 15m|1h|1d|7d`. Read the configured default from `r2fl config get defaultTtl`; if it is not one of the list items, append it to the list and preselect it.
- Cancel must abort cleanly: no upload, no notification (or a quiet "cancelled" one), exit 0.
- Make the prompt skippable via an env var or a second Quick Action variant ("Share via r2-fastlink (default lifetime)") that uses the configured default with no prompt: decide which is less annoying and document the choice.
- Keep the AppleScript strings fixed (no user-controlled text interpolated into osascript source).
- The max TTL is enforced server-side (7 days default); if the server rejects the chosen TTL the notification should show the error (already handled by --notify).

## Acceptance Criteria

- [x] Picking each item results in the correct `--ttl` value (unit-tested through the fake-`r2fl` harness by stubbing the osascript call).
- [x] The configured default lifetime is preselected; a non-standard default (e.g. 45m) appears in the list.
- [x] Cancelling uploads nothing and exits 0.
- [x] A no-prompt variant or opt-out exists and is documented.
- [ ] Owner manual check on a Mac recorded in a note.


## Notes

**2026-10-03T04:21:56Z**

Branch batch-04-macos-quick-action. Picker is in macos/r2fl-quick.sh (choose_ttl): fixed AppleScript, items and default passed as osascript ARGUMENTS (a test asserts the -e source is identical across different defaults/file names). Opt-out decision: a second Quick Action 'Share via r2-fastlink (default lifetime)' calling 'r2fl-quick --no-prompt' (Finder cannot set env vars or flags); both are installed; documented in README and docs/PLAN.md. Default is read with 'r2fl config get defaultTtl' (last line, to tolerate login-shell noise; falls back to 1h if it is not a duration). Tests (macos.test.ts, osascript stubbed): each item -> 15m/1h/1d/7d, default first/preselected, 45m appended+preselected+uploaded as --ttl 45m, cancel ('' or 'false') uploads nothing, no notification, exit 0; failing osascript or missing r2fl notifies and exits 1 instead of guessing a lifetime. AWAITING HUMAN: on a Mac with the Quick Action installed, check the picker appears IN FRONT of Finder (osascript from a Quick Action may open the dialog behind other windows; if so, add an 'activate' step and note it), the configured default is preselected, a 45m default shows up, Cancel does nothing, and the '(default lifetime)' action shows no picker. Record results here and tick the last criterion.
