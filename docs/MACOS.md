# flashlink on macOS

One install gives you both ways to share a file:

- **In Terminal:** `fl up report.pdf` prints a short link and copies it.
- **In Finder:** right-click a file, choose **Quick Actions → Share via flashlink**, pick how long the link should live, and a notification shows the link (also on your clipboard). Select several files and you get one link each and one summarizing notification. A folder is uploaded as a zip (see [Folders](CLI.md#folders)).

Nothing else is needed: no Node, no Homebrew, no clone. You do need a deployed Worker (see the [README quick start](../README.md#quick-start)).

> Status: the wrapper and installer have automated tests (run on Linux in CI) and the whole flow was verified by hand on macOS 26.6.2 (Apple Silicon). The [QA checklist](#manual-qa-checklist) is how to repeat that.

## Install

```sh
curl -fsSL https://github.com/crcatala/flashlink/releases/latest/download/install.sh | sh -s -- --latest
```

The installer downloads the latest release for your Mac (Apple Silicon or Intel), checks every file against the release's `SHA256SUMS`, installs it and tells you what it did, step by step:

| What                                   | Where                                                             |
| -------------------------------------- | ----------------------------------------------------------------- |
| The `fl` command (a standalone binary) | `~/.local/share/flashlink/bin/fl`                                 |
| `fl` and `flashlink` in your terminal  | `~/.local/bin/fl`, `~/.local/bin/flashlink` (links to the binary) |
| The two Quick Actions                  | `~/Library/Services/Share via flashlink*.workflow`                |
| The wrapper the Quick Actions run      | `~/.local/bin/fl-quick`                                           |
| The notifier (posts the notifications) | `~/.local/share/flashlink/notify/flashlink.app`                   |

Terminal and Finder use the same binary, so they are always the same version. It is the CLI compiled with Bun into one file, so it does not need Node and keeps working when you upgrade or switch Node versions.

It ends with a short **Next steps** list, which is what the next section walks through.

To pin a version use `--version v0.0.2` instead of `--latest`. A fork sets `FLASHLINK_REPO=<you>/<fork>` for the installer. If the repository is private, `curl` cannot read the release; install the GitHub CLI and run `gh auth login` once, and the installer falls back to it by itself, or start it with:

```sh
cd "$(mktemp -d)" && gh release download --repo crcatala/flashlink --pattern install.sh && sh install.sh --latest
```

## After installing

**1. Connect fl to your Worker** (once; it asks for your upload token):

```sh
fl init --endpoint https://flashlink.<you>.workers.dev
```

**2. Turn on the Finder menu** (once): open **System Settings → Keyboard → Keyboard Shortcuts… → Services → Files and Folders** and tick **Share via flashlink** (and **Share via flashlink (default lifetime)** if you want it, see [below](#the-two-quick-actions)).

**3. Share a file:** `fl up FILE` in Terminal, or right-click a file in Finder → **Quick Actions → Share via flashlink**. The first notification may ask for permission (System Settings → Notifications → flashlink).

### If Terminal says `fl: command not found`

The installer links `fl` into `~/.local/bin`, which most setups already have on `PATH`. If yours does not, the installer says so and prints the line to add. For zsh (the macOS default):

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

Then open a new Terminal window. The Finder menu works either way: it does not use your `PATH`.

### If you also installed fl with npm

The installer never overwrites an `fl` it did not create. If your terminal finds a different `fl` first (for example `npm i -g flashlink`), the installer names it: Terminal keeps running that one, and Finder runs the installed binary. To have just one, remove the other (`npm uninstall -g flashlink`) or put `~/.local/bin` earlier on your `PATH`. Both use the same config file and history.

## Update and uninstall

**Update:** run the install command again. It replaces the binary, the Quick Actions and the notifier, and keeps your config and history. The new binary is tested before it replaces the old one: if it does not start on your Mac, the installer says so, keeps the binary you had and exits with an error.

**Uninstall:**

```sh
curl -fsSL https://github.com/crcatala/flashlink/releases/latest/download/uninstall.sh | sh
```

(or `sh macos/uninstall.sh` from a clone). It removes the binary and its links, both Quick Actions, the wrapper and the notifier. Your config and history stay (see `fl config path`), and so does any `fl` the installer did not create.

## The two Quick Actions

| Quick Action                             | Behavior                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Share via flashlink`                    | Asks for the lifetime (15 minutes, 1 hour, 1 day, 7 days). Your `defaultTtl` is preselected, so the common case is Return. A non-standard default such as `45m` is added to the list. Cancel does nothing and says nothing. |
| `Share via flashlink (default lifetime)` | No question: uses your configured `defaultTtl`. Enable only this one if the picker annoys you.                                                                                                                              |

The server still enforces the maximum lifetime (7 days by default); if it refuses the choice the notification shows the error.

## How it works

The release's `flashlink-darwin-arm64` / `flashlink-darwin-x64` is the CLI compiled with [Bun](https://bun.sh) into one file (about 60 to 70 MB). The installer signs it ad hoc (`codesign -s -`, no developer account; it is not notarized, which is why the installer fetches it with `curl`, which sets no quarantine flag) and runs it with an empty environment to prove it starts.

Finder starts Quick Actions with a bare `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) and none of your shell setup, which is why the Quick Actions run that binary by its full path instead of looking for `fl`. The work itself is `fl up --notify --ttl <choice> -- <files>`; the token and endpoint come from the normal fl config file, never from the Quick Action.

`fl --version` prints the release and the git commit it was built from (for example `0.0.2 (f04c5b9)`; `-dirty` for a local build with uncommitted changes), and the lifetime dialog shows the same line under "Link lifetime", so you can tell a stale install from a fresh one.

## From a clone (development)

To build the binary from your checkout and install it (needs Bun and `pnpm install`):

```sh
pnpm install:macos     # scripts/build-binary.sh for this Mac, then macos/install.sh --binary
```

Or keep using your own `fl` (for example `npm link` of your working copy) and only install the Quick Actions:

```sh
sh macos/install.sh    # no option: Quick Actions from this folder, your own fl and node
```

Without a standalone binary, a Quick Action has to find your `fl` and `node` itself. The installer records the folders where **this Terminal** finds them in `~/.config/flashlink/quick-action-path` (one line of colon-separated folders; edit it by hand if you like), and the wrapper runs `fl` in your login shell (`/bin/zsh -l`) with those folders in front of `PATH`. If `fl` is still not found, for example after mise or nvm moved to a new Node version, it retries once in an interactive login shell, which also reads `~/.zshrc`. Run `sh macos/install.sh` from a Terminal where `fl --version` works, and again after changing how `fl` is installed. If a standalone binary is installed, the Quick Actions use it instead and ignore all of this.

## Troubleshooting

- _"Could not run fl" notification, or the installer's "a Quick Action cannot run fl"._ Run the install command again: the standalone binary needs nothing else. To test the way a Quick Action starts: `env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin ~/.local/bin/fl-quick --check` prints the `fl` it found. Without a standalone binary (a clone setup), see [From a clone](#from-a-clone-development).
- _The action is missing from the Quick Actions menu._ Enable it in System Settings → Keyboard → Keyboard Shortcuts → Services → Files and Folders. Then run `/System/Library/CoreServices/pbs -flush`, or log out and back in. It only appears when you right-click a file or folder in Finder.
- _No notification appears._ Allow notifications for **flashlink** in System Settings → Notifications (for **Script Editor** if `macos/install.sh` could not build the notifier and printed a note). The first notification may ask for permission. The link is still copied to the clipboard.
- _Clicking a notification opens Script Editor._ The notifier app is missing: run the install command again (it needs `osacompile`, which ships with macOS). It lives in `~/.local/share/flashlink/notify/flashlink.app`.
- _macOS asks to access your Downloads (or Desktop, Documents) folder._ That is macOS's privacy protection, asked once per folder the first time a Quick Action reads a file from there. Choose Allow.
- _macOS blocks the workflow as downloaded or from an unidentified developer._ Remove the quarantine flag: `xattr -dr com.apple.quarantine ~/Library/Services/Share\ via\ flashlink*.workflow` (the installer already does this for what it copies).
- _"Looks like it contains secrets"._ The [secret warning](CLI.md#secret-warning) refuses files such as `.env` or private keys because a Quick Action has no terminal to ask in. Upload it from a terminal with `fl up --allow-secrets -- file` if you really mean to share it.
- _Errors._ The notification carries the message (wrong token, file over the size cap, offline). Run the same upload in a terminal to see more: `fl up --notify -- file`.
- _Where things live._ Config: `~/.config/flashlink/config.json`; history: `~/.local/share/flashlink/history.json` (see `fl config path`); binary: `~/.local/share/flashlink/bin/fl`, linked as `~/.local/bin/fl` and `~/.local/bin/flashlink`; Quick Actions: `~/Library/Services/`; wrapper: `~/.local/bin/fl-quick`; notifier: `~/.local/share/flashlink/notify/`.

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
