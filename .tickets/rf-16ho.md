---
id: rf-16ho
status: open
deps: [rf-kecm, rf-kwsu]
links: []
created: 2026-10-03T17:19:03Z
type: task
priority: 3
assignee: cc-vps
parent: rf-yofr  # Epic: native Finder-only macOS app
tags: [phase-3, macos, release, needs-human, batch-17]
---
# macOS app releases and self-serve updates (GitHub Releases, no auto-update)

Make the Finder-only app (rf-kwsu) easy to install and update for someone who does not want Xcode: a tagged GitHub Release with a prebuilt, ad hoc signed zip, an installer that fetches it, and an easy way to see the installed version and whether a newer one exists. Update is user-initiated (a command), never automatic. Part of epic rf-yofr; depends on the app shell (rf-kwsu) and the design in rf-kecm; the spike already proves the building blocks (macos/spike/build.sh, install.sh, .github/workflows/macos-spike.yml uploading a ditto zip).

## Design

Suggested shape (adapt in rf-kecm):
1. Release workflow on a tag (e.g. app-v0.1.0): macos-latest, Release configuration, MARKETING_VERSION from the tag and CURRENT_PROJECT_VERSION from the run number, git sha in Info.plist; ditto zip + SHA256 file attached to a GitHub Release with generated notes. macOS minutes are the only non-Ubicloud cost (about $0.062/min on a private repo; ~1 min/build).
2. install.sh gains a --latest / --version X mode: gh release download (works while the repo is private; plain curl once public), verify the checksum, then the existing install steps (strip quarantine, pluginkit, restart Finder).
3. Versions: read CFBundleShortVersionString from the installed app (defaults read ~/Applications/r2-fastlink.app/Contents/Info.plist CFBundleShortVersionString), add 'install.sh --check' that compares it with the latest release tag, and make the app itself answerable (e.g. 'r2-fastlink --version' on its binary and the version in its error notifications). Consider an 'r2fl app install|update|version' subcommand family in the CLI that wraps the same thing.
4. No Sparkle for now: it needs an EdDSA key, an appcast and care with ad hoc signing; reconsider only if the owner later wants one-click updates.
5. Homebrew cask in an own tap is the other conventional route (brew upgrade --cask, brew info shows the version). Check current Homebrew policy on unsigned/ad hoc apps and quarantine before committing to it; it is not required for the first cut.

Open risks to test on the second release, on a real Mac: ad hoc signatures change with every build, so check whether macOS re-asks for notification permission, resets any Files and Folders grants, or needs the extension re-enabled after an in-place update; and that updating a running app (killall the old one) is clean.

## Acceptance Criteria

- [ ] Pushing a version tag produces a GitHub Release with the zip and a checksum, built in CI.
- [ ] One command installs the latest release without Xcode; another reports installed vs latest version.
- [ ] An in-place update from version N to N+1 is verified on a real Mac and the findings (permission prompts, extension state) are recorded.
- [ ] README documents install, update, version check and uninstall.

