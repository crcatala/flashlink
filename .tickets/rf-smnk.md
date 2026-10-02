---
id: rf-smnk
status: open
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

- [ ] Picking each item results in the correct `--ttl` value (unit-tested through the fake-`r2fl` harness by stubbing the osascript call).
- [ ] The configured default lifetime is preselected; a non-standard default (e.g. 45m) appears in the list.
- [ ] Cancelling uploads nothing and exits 0.
- [ ] A no-prompt variant or opt-out exists and is documented.
- [ ] Owner manual check on a Mac recorded in a note.

