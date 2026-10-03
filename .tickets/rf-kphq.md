---
id: rf-kphq
status: open
deps: []
links: [rf-od5l, rf-16ho]
created: 2026-10-03T19:49:10Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, macos, release, needs-human, batch-14]
---
# Distribute the standalone r2fl binary: CI release artifact and installer download

PR #12 added the standalone r2fl binary (scripts/build-binary.sh, 'macos/install.sh --binary', 'pnpm install:macos') so the Finder Quick Action no longer depends on the user's node or PATH. Today the binary has to be built on the Mac (needs Bun and a repo checkout) or copied over by hand, so nobody but the owner can use it. Decide and implement how the binary reaches users. This is the one open decision PR #12 left (see docs/PLAN.md, 'Standalone binary (prototype)') and it replaces the app-release scope of rf-16ho for the Quick Action path.

## Design

Options to weigh (write the decision into docs/PLAN.md first, owner approves):
1. A tagged GitHub Release with darwin-arm64 and darwin-x64 binaries plus a SHA256 file. Bun cross-compiles, so CI can build them on a Linux runner (ubicloud-standard-2) with no macOS minutes; the Mac-only steps (strip quarantine, ad hoc codesign, start check) stay in macos/install.sh. Add 'install.sh --latest' / '--version X' that downloads (gh release download while private, curl once public; curl sets no quarantine), verifies the checksum, then installs.
2. A CI job on every PR that runs scripts/build-binary.sh for the darwin targets (and runs the linux one) so a broken build is caught before a release.
3. Versions: r2fl --version already prints '<package version> (<git sha>[-dirty])'; releases need a real version/tag scheme. Decide together with rf-od5l (publish the CLI to npm): one story for 'how do I get r2fl'.
4. Keep building locally for development ('pnpm install:macos'); say so in the README.
5. Once the binary is the default, decide whether to remove the login-shell fallback in macos/r2fl-quick.sh and the recorded-PATH machinery in install.sh (macos.test.ts covers them today).
6. Housekeeping from PR #12 still open: the wrapper's own fixed-text error notifications still use osascript (a click opens Script Editor); route them through the notifier applet.
Hardened runtime and notarization are out of scope (ad hoc signing is enough for a self-built or downloaded-with-curl binary).

## Acceptance Criteria

- [ ] A short decision note in docs/PLAN.md (release shape, versioning, relation to rf-od5l) is approved by the owner BEFORE implementation.
- [ ] Pushing a version tag produces a GitHub Release with both darwin binaries and checksums, built in CI.
- [ ] One command installs the latest release on a Mac without Bun or a checkout; the dialog shows the released version.
- [ ] A PR-time CI job builds the darwin targets.
- [ ] README documents install, update and uninstall for someone who is not the owner.

