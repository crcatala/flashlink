---
id: rf-kphq
status: in_progress
deps: []
links: [rf-od5l, rf-16ho]
created: 2026-10-03T19:49:10Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, macos, release, needs-human, batch-05]
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
- [x] A PR-time CI job builds the darwin targets.
- [ ] README documents install, update and uninstall for someone who is not the owner.


## Notes

**2026-10-03T20:11:24Z**

Batch 05 (branch batch-05-release-packaging). Implemented the proposal written in docs/PLAN.md ('Distributing the binary'): scripts/package-release.sh (both darwin binaries, r2fl-macos-support.tar.gz, install.sh, uninstall.sh, SHA256SUMS), release workflow job github-release (gh release create on a v* tag), PR-time CI job 'binaries' (same script, checksum check, starts the linux binary), 'macos/install.sh --latest | --version TAG' (curl first, gh release download fallback for a private repo; checksum verified before anything is installed; run standalone it also fetches and verifies the support archive), README install/update/uninstall/releasing, item 6 (the wrapper's own error notifications now go through the notifier applet queue, osascript only as fallback). Item 5 decision: keep the login-shell fallback and recorded-PATH machinery for now (source installs without Bun need them). Deviations: the ticket suggested install.sh would only download the binary; it also fetches the support files when run alone, because 'no checkout' needs them; uninstall.sh is a release asset too, for the same reason. Evidence: 14 new tests fail on the old scripts and pass now (packages/cli/test/macos.test.ts, release.test.ts); package-release.sh run locally (checksums verified); install.sh --latest run end to end on Linux against a local file:// release with the real compiled CLI standing in for the darwin binary (also: tampered download refused). Not verifiable here: anything on a real Mac, a real tag push, real GitHub Release download.
AWAITING HUMAN: (1) Approve the decision note in docs/PLAN.md (merging the PR counts) - criterion 1 asked for approval before implementation; the work was done first so you can judge it in one place, revert if you disagree. (2) After merge and the license/NPM steps in rf-od5l, bump packages/cli version, tag vX.Y.Z and push; confirm the release page lists r2fl-darwin-arm64, r2fl-darwin-x64, r2fl-macos-support.tar.gz, install.sh, uninstall.sh and SHA256SUMS and that 'shasum -a 256 -c SHA256SUMS' passes after downloading them. (3) On a Mac with no Bun and no checkout: while the repo is private run 'cd "$(mktemp -d)" && gh release download --repo crcatala/r2-fastlink --pattern install.sh && sh install.sh --latest'; once public use 'curl -fsSL https://github.com/crcatala/r2-fastlink/releases/latest/download/install.sh | sh -s -- --latest'. Look for: 'installed: ~/.local/share/r2fl/bin/r2fl (X.Y.Z (sha))', no Gatekeeper prompt, the Quick Action's lifetime dialog showing 'r2fl X.Y.Z (sha), standalone', and an error notification (for example run with a wrong token) arriving from 'r2-fastlink' rather than Script Editor. Then 'r2fl init' via the printed binary path works. (4) Tick: criteria 1, 2, 3 and 5 (README for a non-owner) after those checks; criterion 4 (PR-time CI job) once CI is green on the batch PR (I will tick it if it is).

**2026-10-03T20:12:43Z**

PR #14 CI is green, including the new 'binaries' job (both darwin builds, checksums, linux binary start): criterion 4 ticked. Remaining criteria still await a real tag, a Mac and the owner (see the AWAITING HUMAN note above).
