# Finder integration (macOS)

Right-click a file in Finder, choose **Quick Actions → Share via flashlink**, pick how long the link should live, and a notification shows the short link, which is also on your clipboard. Select several files and you get one link each and one summarizing notification. A folder is uploaded as a zip (see [Folders](CLI.md#folders)).

> Status: the wrapper and installer have automated tests (run on Linux in CI) and the whole flow was verified by hand on macOS 26.6.2 (Apple Silicon). The [QA checklist](#manual-qa-checklist) is how to repeat that.

## Install

No clone, no Bun, no Node needed:

```sh
curl -fsSL https://github.com/crcatala/flashlink/releases/latest/download/install.sh | sh -s -- --latest
```

That downloads the latest release's standalone `fl` for your Mac (Apple Silicon or Intel), the Quick Actions and the notifier, checks each download against the release's `SHA256SUMS`, and installs them. To pin a version use `--version v0.1.0`. A fork sets `FLASHLINK_REPO=<you>/<fork>` for the installer.

If the repository is private, `curl` cannot read the release; use the GitHub CLI (`gh auth login` once), which the installer falls back to by itself:

```sh
cd "$(mktemp -d)" && gh release download --repo crcatala/flashlink --pattern install.sh && sh install.sh --latest
```

Then point the binary at your Worker (it is not on your `PATH`, and it uses the same config file as any other `fl`):

```sh
~/.local/share/flashlink/bin/fl init --endpoint https://fl.example.com
```

Finally, enable the Quick Actions once in **System Settings → Keyboard → Keyboard Shortcuts… → Services → Files and Folders**.

**Update:** run the install command again; it replaces the binary, the Quick Actions and the notifier and keeps your config and history. The new binary is tested before it replaces the old one: if it does not start on your Mac, the installer says so, keeps the binary you had and exits with an error.

**Uninstall:** `curl -fsSL https://github.com/crcatala/flashlink/releases/latest/download/uninstall.sh | sh` (or `sh macos/uninstall.sh` from a clone). It removes both Quick Actions, the wrapper, the notifier and the standalone binary; your config and history are left alone.

### From a clone

For development, or when there is no release yet. With the CLI installed and configured as in the [CLI install](CLI.md#install),

```sh
fl init --endpoint https://fl.example.com
sh macos/install.sh                 # uses your own fl and node, found in your login shell
pnpm install:macos                  # or: build the standalone binary for this Mac (needs Bun) and install it
```

The installer copies two Quick Actions to `~/Library/Services/` and a wrapper to `~/.local/bin/fl-quick`, checks that a login shell can find `fl` and `node`, and refreshes the Services menu. The notification names a file in a folder if the [secret warning](CLI.md#secret-warning) refuses it.

## The two Quick Actions

| Quick Action                             | Behavior                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Share via flashlink`                    | Asks for the lifetime (15 minutes, 1 hour, 1 day, 7 days). Your `defaultTtl` is preselected, so the common case is Return. A non-standard default such as `45m` is added to the list. Cancel does nothing and says nothing. |
| `Share via flashlink (default lifetime)` | No question: uses your configured `defaultTtl`. Enable only this one if the picker annoys you.                                                                                                                              |

The server still enforces the maximum lifetime (7 days by default); if it refuses the choice the notification shows the error.

## The standalone binary (no node or PATH needed)

The release's `flashlink-darwin-arm64` / `flashlink-darwin-x64` is the CLI compiled with [Bun](https://bun.sh) into one file (about 60 to 70 MB). The installer copies it to `~/.local/share/flashlink/bin/fl` (with `flashlink` next to it, a symlink to `fl`, the same alias the npm package has), ad hoc signs it (`codesign -s -`, no developer account; it is not notarized, which is why the installer fetches it with `curl`, which sets no quarantine flag) and runs it with an empty environment to prove it starts.

The Quick Actions then run that file directly. If it is missing, or cannot start (exit 126/127), they fall back to the login-shell lookup described below. It is a second copy of `fl`, used only by the Quick Actions: your own `fl` is untouched.

`fl --version` prints the release and the git commit it was built from (for example `0.1.0 (a1b2c3d)`; `-dirty` for a local build with uncommitted changes), and the lifetime dialog shows the same line under "Link lifetime", so you can tell a stale install from a fresh one.

To build one yourself, `pnpm build:binary` (or `sh scripts/build-binary.sh darwin-arm64`; it cross-compiles, so Linux works too) and `sh macos/install.sh --binary dist/bin/flashlink-darwin-arm64`; `pnpm install:macos` does both for your architecture.

## How it works without the standalone binary

Quick Actions run with a minimal `PATH` that has neither `fl` nor `node`. `install.sh` therefore records the folders where **your Terminal** finds them in `~/.config/flashlink/quick-action-path` (one line of colon-separated folders; edit it by hand if you like), and the wrapper puts them in front of `PATH`.

Everything runs in your login shell (`/bin/zsh -l`); if `fl` is still not found, for example after mise or nvm moved to a new Node version, it retries once in an interactive login shell, which also reads `~/.zshrc`. The actual work is `fl up --notify --ttl <choice> -- <files>`; the token and endpoint come from the normal fl config file, never from the Quick Action. Run `macos/install.sh` from a Terminal where `fl --version` works, and run it again after changing how `fl` is installed.

## Troubleshooting

- _"Could not run fl" notification, or the installer's WARNING._ A Quick Action could not find `fl` or `node`. Run `fl --version` in your Terminal; if that works, run `sh macos/install.sh` from that same Terminal so it records the right folders. To test the way a Quick Action starts: `env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin ~/.local/bin/fl-quick --check` prints the two paths it found. If you use a version manager, check that the recorded folder still exists (`cat ~/.config/flashlink/quick-action-path`); you can also write the folders in that file yourself.
- _The action is missing from the Quick Actions menu._ Enable it in System Settings → Keyboard → Keyboard Shortcuts → Services → Files and Folders. Then run `/System/Library/CoreServices/pbs -flush`, or log out and back in. It only appears when you right-click a file or folder in Finder.
- _No notification appears._ Allow notifications for **flashlink** in System Settings → Notifications (for **Script Editor** if `macos/install.sh` could not build the notifier and printed a note). The first notification may ask for permission. The link is still copied to the clipboard.
- _Clicking a notification opens Script Editor._ The notifier app is missing: run `sh macos/install.sh` again (it needs `osacompile`, which ships with macOS). It lives in `~/.local/share/flashlink/notify/flashlink.app`.
- _macOS asks to access your Downloads (or Desktop, Documents) folder._ That is macOS's privacy protection, asked once per folder the first time a Quick Action reads a file from there. Choose Allow.
- _macOS blocks the workflow as downloaded or from an unidentified developer._ Remove the quarantine flag: `xattr -dr com.apple.quarantine ~/Library/Services/Share\ via\ flashlink*.workflow` (the installer already does this for what it copies).
- _"Looks like it contains secrets"._ The [secret warning](CLI.md#secret-warning) refuses files such as `.env` or private keys because a Quick Action has no terminal to ask in. Upload it from a terminal with `fl up --allow-secrets -- file` if you really mean to share it.
- _Errors._ The notification carries the message (wrong token, file over the size cap, offline). Run the same upload in a terminal to see more: `fl up --notify -- file`.
- _Where things live._ Config: `~/.config/flashlink/config.json`; history: `~/.local/share/flashlink/history.json` (see `fl config path`); Quick Actions: `~/Library/Services/`; wrapper: `~/.local/bin/fl-quick`; standalone binary (if installed): `~/.local/share/flashlink/bin/fl` and the `flashlink` symlink beside it; notifier: `~/.local/share/flashlink/notify/`.

## Manual QA checklist

Run on a real Mac; record the macOS version. `sh macos/qa.sh 2>&1 | tee ~/flashlink-qa.log` walks through nearly all of it for you and checks the links' contents; the Finder-click rows (1, 11) are by hand:

| #   | Case                                                    | Expect                                                               |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | One file, picker, choose "1 hour" (the default)         | Notification with the URL, URL on the clipboard, URL serves the file |
| 2   | Several files selected                                  | One link each, one summarizing notification                          |
| 3   | File name with spaces, unicode, a quote, a leading dash | Uploads; the link serves the right file                              |
| 4   | File over the 50 MB cap                                 | Error notification, no link                                          |
| 5   | Wrong token (`fl config set token ...`)                 | Error notification                                                   |
| 6   | Offline                                                 | Error notification                                                   |
| 7   | Cancel in the lifetime picker                           | Nothing uploaded, no notification                                    |
| 8   | `defaultTtl` = `45m`                                    | The picker lists "45m" and preselects it                             |
| 9   | "(default lifetime)" action                             | No picker; link expires after the configured default                 |
| 10  | `macos/uninstall.sh`                                    | Both actions disappear from the menu                                 |
| 11  | The picker window                                       | Appears in front of Finder (not hidden behind other windows)         |

A native Finder app with a root-level menu was spiked and deferred; see [ARCHITECTURE](ARCHITECTURE.md#9-status-and-roadmap).
