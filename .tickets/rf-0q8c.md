---
id: rf-0q8c
status: open
deps: [rf-hx3f]
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-2, macos]
---
# Phase 2.2: Finder Quick Action bundle, wrapper and installer (macos/)

## Why
This is the Finder integration itself: a Quick Action (macOS "Services") that appears in the right-click menu for files, calls `r2fl up --notify`, and needs no terminal. First pass is a Quick Action only; a native Swift menubar app is explicitly out of scope for now (phase 3).

## Scope
A `macos/` directory containing the Quick Action bundle and an installer script, plus a wrapper that solves the PATH problem.

## Design

Known constraints (decide with these in mind):
- Quick Actions/Automator run with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so `r2fl` and `node` (often managed by mise/nvm/Homebrew) will NOT be found. Solve this in a wrapper script `macos/r2fl-quick.sh` that runs the CLI through the user's login shell (e.g. `/bin/zsh -l -c 'r2fl up --notify -- "$@"' r2fl "$@"`) or resolves an absolute path recorded at install time. Handle spaces in filenames (always quote and use `--`).
- The workflow bundle is a directory `Share via r2-fastlink.workflow/Contents/{Info.plist,document.wflow}` configured as: "Workflow receives current: files or folders in Finder", with a single "Run Shell Script" action (shell /bin/zsh, "Pass input: as arguments") that calls the wrapper. Generate the plists as text files checked into `macos/`. Validate with `plutil -lint` (macOS only).
- Installer `macos/install.sh`: copies the workflow to `~/Library/Services/`, installs the wrapper (e.g. `~/.local/bin/r2fl-quick`), verifies `r2fl` resolves, runs `/System/Library/CoreServices/pbs -flush` (or tells the user to) so the Services menu refreshes, and prints how to enable it in System Settings -> Keyboard -> Keyboard Shortcuts -> Services -> Files and Folders. Provide `macos/uninstall.sh`.
- This repo is developed on Linux: the agent CANNOT run the workflow. Make everything that can be unit-tested testable (shell wrapper argument quoting via a bats-free sh test using a fake `r2fl`), `shellcheck`-clean, and write precise manual verification steps for the owner.
- Never hardcode the user's home path, token or endpoint in the bundle; configuration comes from the normal r2fl config file.

## Acceptance Criteria

- [ ] `macos/` contains the workflow bundle sources, `r2fl-quick.sh`, `install.sh` and `uninstall.sh`; scripts are `shellcheck`-clean (record the command and result).
- [ ] A test (runs on Linux in CI) invokes `r2fl-quick.sh` with a fake `r2fl` on PATH and proves: arguments with spaces, quotes and leading dashes arrive intact; a failing `r2fl` exit code propagates.
- [ ] `plutil -lint` passes on the plists (manual on a Mac; record the output).
- [ ] Owner verifies on a real Mac: right-click a file in Finder -> Quick Actions -> "Share via r2-fastlink" -> notification with URL appears, URL is on the clipboard, the URL serves the file. Record the result as a note; fix wrapper/PATH issues found.
- [ ] Uninstall removes everything install created.
- [ ] Multiple selected files produce one link each and one summarized notification.

