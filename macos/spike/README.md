# Finder Sync extension spike (rf-og97)

**Question:** can a Finder Sync extension, built on your own Mac with local signing only (no paid
Apple Developer account, no notarization), show a root-level **Share via r2-fastlink** menu with a
lifetime submenu and hand the selected files to a helper app?

This spike uploads nothing. If it works, a follow-up ticket designs the real Finder-only app; if
not, we stay with the Quick Action in `macos/` (PR #10) or try an Apple Shortcut.

> Status: **VIABLE** (2026-10-03, macOS 26.6.2). The extension, signed ad hoc, shows the root-level menu
> and hands the selection to the host app; see [`FINDINGS.md`](FINDINGS.md) for the results, caveats and
> recommendation. The steps below are how to reproduce the run. A native app is deferred (see the
> update in `FINDINGS.md`); this folder stays as the reference for it.

## What is here

| Path                                 | What                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.yml`                        | XcodeGen spec for two targets (the `.xcodeproj` is generated, not checked in)                                                                                 |
| `App/`                               | Host app "r2-fastlink": `LSUIElement` (no Dock icon), registers `r2fl-spike://`, logs every hand-off to `~/Library/Logs/r2fl-spike.log`, posts a notification |
| `FinderExt/`                         | The Finder Sync extension (sandboxed; entitlements are only `app-sandbox` and `files.user-selected.read-only`, so no provisioning profile)                    |
| `Shared/HandOff.swift`               | The hand-off format (`r2fl-spike://share?ttl=1h&path=…&path=…`, every byte percent-encoded) compiled into both targets                                        |
| `SelfTest/main.swift`                | Foundation-only test of `HandOff.swift`; runs on Linux or macOS with `swiftc`, no Xcode                                                                       |
| `build.sh` / `install.sh` / `run.sh` | Build, install to `~/Applications`, enable the extension, restart Finder (`--uninstall` reverses it)                                                          |
| `test-handoff.sh`                    | Exercises the host app half without Finder: awkward file names in, log lines compared out                                                                     |

Why a URL scheme: it needs no App Group and no provisioning profile (an App Group requires a signed
team identity). The sandboxed extension simply calls `NSWorkspace.open(url)`; LaunchServices starts
the host app. The cost is URL length, see "Open questions".

## Build and run

### Option A: no Xcode, use the CI build

`.github/workflows/macos-spike.yml` builds the app on a GitHub-hosted Mac (ad hoc signed, same
`build.sh`) whenever `macos/spike/` changes, and can be started by hand (Actions → macOS spike → Run
workflow). On your Mac you only need `git` and `gh`:

```sh
gh run list --workflow macos-spike.yml --branch spike/rf-og97-finder-sync -L 3   # pick a green run
gh run download <run-id> -n r2-fastlink-spike -D ~/Downloads/r2fl-spike
sh macos/spike/install.sh ~/Downloads/r2fl-spike/r2-fastlink-spike.zip
```

`install.sh` strips the download quarantine flag, copies the app to `~/Applications`, opens it once
(this registers the URL scheme and asks for notification permission), registers and enables the
extension with `pluginkit`, and restarts Finder. Note in `FINDINGS.md` that this build was made by CI.
The job log also shows the CI build's `codesign` output and the host-app half of `test-handoff.sh`
(informational: a CI Mac has no Finder session, so it cannot answer the ticket's question).

### Option B: build locally

You need Xcode (the app, not just the command line tools), XcodeGen and a Terminal.

```sh
brew install xcodegen
sh macos/spike/run.sh                 # ad hoc signing ("Sign to Run Locally"), watches "/"
```

`run.sh` is `build.sh` (prints macOS and Xcode versions, runs `xcodegen` and `xcodebuild`) followed by
`install.sh` (prints the signature it ended up with; copy it into `FINDINGS.md`).

Variants:

```sh
WATCH=home sh macos/spike/run.sh      # watch the home folder + each mounted volume instead of "/"
SIGNING=team TEAM=ABCDE12345 sh macos/spike/run.sh   # only if ad hoc fails: free personal Apple ID team
sh macos/spike/install.sh --uninstall   # same as run.sh --uninstall
```

No team id, identity or profile is stored anywhere in the repo; `TEAM` comes from your environment.
To build from Xcode instead: `cd macos/spike && xcodegen generate && open R2FLSpike.xcodeproj`, then in
both targets choose Signing → "Sign to Run Locally".

## If the menu does not appear

1. `pluginkit -m -v -i dev.r2fastlink.spike.FinderSync` should list the extension; a `+` in front means enabled.
2. Enable it by hand: **System Settings → General → Login Items & Extensions → Extensions** (the
   "Added Extensions" / Finder entry; on macOS 13/14 it is Privacy & Security → Extensions → Added
   Extensions). Then `killall Finder`.
3. Stream the extension's own log while you right-click:
   `log stream --predicate 'subsystem == "dev.r2fastlink.spike"' --level info`.
   The line `watching (root): /` proves the extension was loaded.
4. `codesign -dvv ~/Applications/r2-fastlink.app/Contents/PlugIns/R2FLFinderSync.appex` and
   `log show --last 5m --predicate 'process == "pkd" OR process == "Finder"'` hold the reason if macOS refused to load it. Paste the exact error into `FINDINGS.md`.

## Test script (about 15 minutes)

Do these in order and write each result into `FINDINGS.md`.

1. **Hand-off without Finder:** `sh macos/spike/test-handoff.sh`. Expect `ALL PASSED` and a
   notification titled **r2-fastlink** (not Script Editor).
2. **Root menu:** right-click a file on the Desktop. Expect **Share via r2-fastlink ▸** with
   15 minutes / 1 hour / 1 day / 7 days in the root menu, not inside Quick Actions. Take a screenshot.
3. **Locations:** right-click a file in Desktop, Documents, Downloads, a subfolder, an external drive
   and a network volume if you have one; also a folder, and the folder background (no menu is
   expected there, the spike only handles selected items). Record which locations show the menu.
   Repeat with `WATCH=home` and note the differences.
4. **Hand-off from Finder:** click "1 hour" with one file, then select several files and click again.
   `tail ~/Library/Logs/r2fl-spike.log` must list all of them with `ttl=1h`, and the notification says
   `would share N file(s) for 1h: ...`. Try 15 minutes / 1 day / 7 days once each.
5. **Names:** repeat step 4 on the files `test-handoff.sh` created in `~/r2fl-spike-files` (spaces,
   quotes, `&=+%#?`, unicode and emoji, a leading dash).
6. **Many files:** select 200+ files (for example `/usr/bin` copies) and share. Does the log show all
   of them, or does nothing happen (URL too long)?
7. **Lifecycle:** log out and back in: is the menu still there without `pluginkit`? Edit a Swift
   file, run `run.sh` again: does the new build load right away, or does it need `killall Finder`
   or a manual re-enable? Quit the host app (`killall r2-fastlink`) and click again: does the
   hand-off relaunch it?
8. **Prompts:** note every Gatekeeper, "damaged/unidentified developer" or Files-and-Folders
   privacy prompt, and whether the host app's first launch needs right-click → Open.
9. Fill in the **verdict** at the bottom of `FINDINGS.md` and tell the agent, or follow the
   "If viable" / "If not viable" steps in the ticket.

## Open questions this spike answers

- Does ad hoc signing load a Finder Sync extension at all? (Newer macOS may demand a team-signed one.)
- Is `/` accepted for `directoryURLs`, and does it cover the Desktop, iCloud Drive, external and network volumes?
- Is the submenu shown at the root, and do `tag` and `selectedItemURLs()` survive Finder's menu proxying?
- Does `NSWorkspace.open(url)` from the sandboxed extension reach the host app, and how many paths fit in a URL?
- Does the notification come from "r2-fastlink" when the app is ad hoc signed?

## Linux checks (no Mac needed)

```sh
swiftc -o /tmp/handoff-selftest macos/spike/Shared/HandOff.swift macos/spike/SelfTest/main.swift && /tmp/handoff-selftest
pnpm --filter r2fl test        # macos-spike.test.ts: ids, scheme, entitlements, shell encoder, no signing material
```
