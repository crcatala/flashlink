---
id: rf-hx3f
status: in_progress
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-2, cli, macos, batch-03]
---
# Phase 2.1: CLI --notify (macOS notification) and machine-readable --json errors

## Why
Phase 2 gives the Finder right-click experience: select file(s) -> Quick Actions -> "Share via r2-fastlink" -> a notification shows the short URL and it is on the clipboard. The Quick Action will shell out to `r2fl`, so the CLI needs to behave well when launched with NO terminal: no TTY, minimal PATH, no way to show stderr. A notification is the only feedback channel, so success and failure must both be reported through one.

## Scope
Add to the CLI (macOS only for the notification part): `r2fl up --notify` which, after finishing (or failing), posts a macOS notification via `osascript` containing the URL (or the error), and keep clipboard copy working in this mode. Also make failures machine-readable.

## Design

- Implement notification in a small module `packages/cli/src/notify.ts` that runs `osascript -e 'display notification "<text>" with title "r2-fastlink" subtitle "<subtitle>"'` through an injectable runner (add `notify(title, body)` to the `Context` interface in src/context.ts so tests can assert on it). ESCAPE the text for AppleScript string literals (quotes, backslashes, newlines); URLs/filenames are untrusted input, never interpolate raw. Do nothing (return false) on non-darwin or if osascript is missing.
- `up --notify`: on success notify "Link copied: <url>" (one notification summarizing N files if several); on failure notify the error message. Still print the URL on stdout and exit non-zero on failure so it also works in scripts. `--notify` implies clipboard copy unless `--no-copy`.
- `--json` error mode: when `--json` is set and the command fails, print `{"error": "<code>", "message": "..."}` (use ApiError.code for server errors, `cli_error` for CliError) to stdout and exit 1, so wrappers can parse failures. Do this in the top-level handler in src/index.ts.
- Do NOT touch the stdout-is-URL-only contract.
- Notification click-to-open is out of scope (osascript `display notification` cannot attach an action).

## Acceptance Criteria

- [ ] `r2fl up --notify file` on macOS shows a notification with the URL; on failure shows the error text (manual check on a Mac, recorded in a note).
- [x] Unit tests: notification text is correctly escaped for AppleScript (quotes, backslashes, newlines, unicode filenames); notify is a no-op on non-darwin; notify is called once per invocation with a sensible summary for 1 and N files, and with the error for failures. All with an injected runner (no real osascript in tests).
- [x] `--json` failure output is valid JSON with `error` and `message`, exit code 1, covered by tests for CliError and ApiError cases.
- [x] stdout still contains only URLs (or the JSON result) in all modes; existing tests untouched and green.
- [x] README documents `--notify`.


## Notes

**2026-10-03T02:20:51Z**

Branch batch-03-cli-notify-json-errors. Implemented on Linux: src/notify.ts (AppleScript escaping, absolute /usr/bin/osascript, injectable runner, 5s timeout, no-op off darwin), Context.notify, up --notify, src/report.ts (--json failures as one compact stdout line, stderr empty). Deviations: Context.notify(subtitle, body) (title is fixed 'r2-fastlink'); --notify copies even if config copy=false unless --no-copy; one notification per invocation, and on partial multi-file failure it is the 'N of M uploads failed' error (successful URLs stay on stdout/clipboard); with up --json and partial failure the results array is printed first, then the error line. Evidence: pnpm test 182 passing (CLI 80), mutation of the escaper makes tests fail, built CLI exercised against wrangler dev (cli_error, unauthorized, ttl_too_long all exit 1). AWAITING HUMAN: criterion 1 needs a real Mac. Run 'pnpm build' then 'node packages/cli/dist/index.js up <file> --notify' against any deployment or wrangler dev: expect a notification titled r2-fastlink, subtitle 'Link copied', body = URL, URL on the clipboard. Then run it with a bad endpoint/token (R2FL_TOKEN=bad) and expect subtitle 'Upload failed' with the error text. Also try a filename containing double quotes and a backslash. Tick criterion 1 and close the ticket.
