# Findings: Finder Sync spike (rf-og97)

Run on 2026-10-03. Screenshots are in a comment on PR #11.

## Verdict

**VIABLE.** A Finder Sync extension signed only with an ad hoc ("Sign to Run Locally") signature loads
on macOS 26.6.2, shows **Share via r2-fastlink ▸ 15 minutes / 1 hour / 1 day / 7 days** at the **root**
of Finder's context menu, and hands every selected path plus the chosen lifetime to a helper app. No
paid Apple Developer account, no team id, no provisioning profile, no App Group, no notarization.

## Environment

- macOS: 26.6.2 (owner's Mac and the CI Mac). The owner's Mac is presumably Apple Silicon: the CI build is arm64 only and ran there.
- Xcode: none on the owner's Mac. The app was built by GitHub Actions (`macos-latest`: Xcode 26.6, Swift 6.3.3) and installed with `install.sh`.
- Signing mode that worked: **ad hoc** (`codesign -dvv`: `Signature=adhoc`, `TeamIdentifier=not set`). The personal-team fallback was never needed.
- The extension is sandboxed; its entitlements are `app-sandbox` and `files.user-selected.read-only` (plus `get-task-allow`, which Debug builds add). `codesign --verify --deep --strict` passes.

## Results

| #   | Step                                                        | Result                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `test-handoff.sh`, notification from r2-fastlink            | PASS, 6/6 awkward names. Notification is titled "r2-fastlink", not Script Editor (screenshots).                                                                                                                                      |
| 2   | Root-level menu with submenu                                | PASS. At the root, next to Quick Actions and Services, not inside Quick Actions (screenshot).                                                                                                                                        |
| 3   | Locations (with `directoryURLs = ["/"]`)                    | Every location the owner tried showed the menu. The background of a Finder folder shows none, which is expected (the spike only handles selected items). Which volumes were tried was not itemized; Downloads is in the screenshots. |
| 3   | Same list with `WATCH=home`                                 | Not tried, and not needed: `/` already works (see below).                                                                                                                                                                            |
| 4   | One file, then several files, then all four lifetimes       | PASS. The host app log shows 1, 3 and 2 files at 1h, then 15m, 1d and 7d, so each lifetime maps to the right `ttl` and all paths arrive.                                                                                             |
| 5   | Names with spaces, quotes, unicode, leading dash via Finder | PASS. They arrived intact in the log.                                                                                                                                                                                                |
| 6   | Large selection                                             | PASS. 924 files in one selection (15m): all received, notification "would share 924 file(s) ...". The URL hand-off did not hit a limit.                                                                                              |
| 7   | Survives logout/login                                       | Reported as working as expected (not itemized separately).                                                                                                                                                                           |
| 7   | Reinstall/rebuild                                           | The new build loads without `killall Finder` or any `pluginkit` command by hand (`install.sh` runs `pluginkit` itself).                                                                                                              |
| 7   | Hand-off relaunches the host app if it is quit              | PASS. After `killall r2-fastlink` the next click started it again (the URL scheme launches it).                                                                                                                                      |
| 8   | Gatekeeper / privacy prompts                                | None. The app came from CI; `install.sh` strips the quarantine flag.                                                                                                                                                                 |
| -   | Extension enabling                                          | The menu appeared right after `install.sh` (`pluginkit -a` + `pluginkit -e use`); nothing had to be enabled in System Settings.                                                                                                      |

CI-only evidence (run 37138241482 on PR #11): both targets build, the bundle verifies, `pluginkit`
lists the extension as enabled, and the host-app half of `test-handoff.sh` passes on a headless Mac.

## Which `directoryURLs` setting is needed

`["/"]` is enough: it covered everything the owner tried. The `WATCH=home` variant (home folder plus each
mounted volume) was built as a fallback in case Finder rejected `/`; it is not needed and can be
dropped from the real app, unless a later reason to narrow the watched set appears (for example if
`/` makes Finder slower, which was not observed).

## Caveats and notes for the real app

- A Finder Sync menu is only offered when items are selected inside a watched directory. The
  folder-background menu is a separate `FIMenuKind` and was deliberately not implemented.
- The hand-off is a custom URL with every path percent-encoded. 924 paths worked; a few thousand long
  paths might exceed some limit. Not measured. If it ever matters, the host app could be given the
  paths another way (a pasteboard, or file URLs passed to `NSWorkspace.open(_:withApplicationAt:...)`).
- The spike is built in the Debug configuration (it has `get-task-allow`). The real app should ship a
  Release configuration.
- Distribution stays "people build it themselves". Both ways were exercised: `xcodebuild` (in CI, same
  as `run.sh`) and a prebuilt ad hoc zip with `install.sh`, which strips quarantine. A downloaded ad
  hoc app would otherwise be blocked by Gatekeeper.
- Not tested: macOS versions other than 26.6.2 (earlier releases keep the extension switch in a
  different Settings pane), an Intel Mac, and the menu when the host app is not installed in
  `~/Applications`.

## Recommendation

**Design the real Finder-only app** (follow-up ticket `rf-kecm`, and `rf-kwsu` rescoped around it). It
removes the PATH, node and shell dependency that made the Quick Action fragile, and puts the menu at the
root with a native lifetime submenu. Keep the Quick Action (`macos/`) as the fallback until the app ships.
