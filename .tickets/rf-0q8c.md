---
id: rf-0q8c
status: in_progress
deps: [rf-hx3f]
links: [rf-og97]
created: 2026-10-02T20:05:53Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-2, macos, batch-04]
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

- [x] `macos/` contains the workflow bundle sources, `r2fl-quick.sh`, `install.sh` and `uninstall.sh`; scripts are `shellcheck`-clean (record the command and result).
- [x] A test (runs on Linux in CI) invokes `r2fl-quick.sh` with a fake `r2fl` on PATH and proves: arguments with spaces, quotes and leading dashes arrive intact; a failing `r2fl` exit code propagates.
- [ ] `plutil -lint` passes on the plists (manual on a Mac; record the output).
- [ ] Owner verifies on a real Mac: right-click a file in Finder -> Quick Actions -> "Share via r2-fastlink" -> notification with URL appears, URL is on the clipboard, the URL serves the file. Record the result as a note; fix wrapper/PATH issues found.
- [x] Uninstall removes everything install created.
- [x] Multiple selected files produce one link each and one summarized notification.


## Notes

**2026-10-03T04:21:56Z**

Branch batch-04-macos-quick-action (PR for that branch). Added macos/: r2fl-quick.sh wrapper (runs r2fl via the login shell, '--' before files, propagates exit codes, own fixed notification on 126/127), install.sh/uninstall.sh, and two .workflow bundles (checked-in Info.plist + document.wflow). Evidence: shellcheck 0.11.0 'shellcheck macos/*.sh' = clean. packages/cli/test/macos.test.ts (24 tests, run on Linux) covers spaces/quotes/leading dashes/newline-free unicode/glob/empty arg passing, exit-code propagation, install+uninstall leaving $HOME exactly as before. Mutation-checked (dropping '--', swallowing the exit code, cancel exiting 1 each fail tests). Real-CLI run: built r2fl against wrangler dev through the installed wrapper with two files -> two links, both served; wrong token and missing file exit 1. Plists parse with python plistlib; they were written by hand to Automator's Quick Action structure, NOT produced by Automator. Deviations: none from the design; wrapper test hooks R2FL_QUICK_SHELL/R2FL_QUICK_OSASCRIPT and installer R2FL_INSTALL_ANY_OS exist only so Linux can test it. AWAITING HUMAN: (1) on a Mac run 'plutil -lint' on the four plists in macos/*.workflow/Contents/ and tick criterion 3 with the output; (2) run sh macos/install.sh, enable the action in System Settings -> Keyboard -> Keyboard Shortcuts -> Services -> Files and Folders, right-click a file in Finder -> Quick Actions -> 'Share via r2-fastlink': expect a notification with the URL, URL on the clipboard, URL serves the file; record the macOS version and tick criterion 4. If Automator rejects or ignores the hand-written workflow, re-create it in Automator (Quick Action, files/folders in Finder, Run Shell Script, zsh, pass input as arguments) and copy the generated files back into macos/.

**2026-10-03T05:06:50Z**

Mac QA finding (owner, first run): the Quick Action loads and the wrapper runs (so the hand-written workflow is accepted), but it reported 'r2fl or node was not found by your login shell'. Cause: install.sh's PATH check ran the login shell with the Terminal's full PATH inherited, so it passed falsely. install.sh now checks with env -i and a minimal PATH (what a Quick Action gets); regression test added. The owner's own PATH setup (probably in ~/.zshrc or ~/.local/bin not on PATH) still needs fixing on the Mac.
