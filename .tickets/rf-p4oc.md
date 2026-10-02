---
id: rf-p4oc
status: closed
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, cli]
---
# Phase 1.6: CLI foundation, init and up

## Why
The CLI is the primary client and must be scriptable (stdout = URL only), work on macOS and Linux, and honor a global default TTL that a single upload can override.

## What was done (packages/cli)
Commander-based `r2fl` (bin built by tsup to dist/index.js, shebang). `src/context.ts` injects everything a command touches (config, history, stdout/stderr, clipboard, stdin, prompt, client factory) so commands are testable. Content-type detection via the `mime` package with a text/plain-vs-octet-stream sniff fallback. Clipboard copy is best-effort (pbcopy, wl-copy, xclip, xsel). Commands in this ticket: `init`, `up`, `config` (show/get/set/path).

## Acceptance Criteria

- [x] `r2fl init` verifies endpoint+token against /api/status and only saves on success (--no-verify to skip); token prompt does not echo.
- [x] `r2fl up` handles files, several files, stdin (`--name`), `--ttl`, `-d/--max-downloads`, `--with-name`, `--json`, `--no-copy`, `-q`.
- [x] Only URLs go to stdout; errors are one labelled line each; a single failure is reported once, multiple failures continue and exit non-zero.
- [x] Client-side size pre-check (default 50 MB) before any network call; server still enforces its own.
- [x] Config at ~/.config/r2fl/config.json (mode 600), env overrides R2FL_ENDPOINT/R2FL_TOKEN/R2FL_TTL, XDG paths respected.


## Notes

**2026-10-02T20:05:53Z**

Implemented and reviewed in PR #1 (branch feat/phase-1-worker-cli); closed as part of the epic setup.
