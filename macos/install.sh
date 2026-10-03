#!/bin/sh
# Install the Finder Quick Actions ("Share via r2-fastlink") for the current user.
#
#   ~/Library/Services/Share via r2-fastlink.workflow                      (asks for a lifetime)
#   ~/Library/Services/Share via r2-fastlink (default lifetime).workflow   (no question)
#   ~/.local/bin/r2fl-quick                                                (wrapper both call)
#   ~/.config/r2fl/quick-action-path       (where r2fl and node were found in THIS terminal)
#   ~/.local/share/r2fl/bin/r2fl           (only with --binary: standalone r2fl, no node needed)
#   ~/.local/share/r2fl/notify/r2-fastlink.app   (posts the notifications; see notify-applet.applescript)
#
# Usage: install.sh [--binary FILE | --latest | --version TAG]
#   --binary FILE  a standalone r2fl built by scripts/build-binary.sh (copy it to the Mac first).
#                  The Quick Actions then run it directly and no longer need node or a PATH.
#   --latest       download the newest GitHub release's binary for this Mac and install it as
#   --version TAG  --binary does (TAG is for example v0.1.0 or 0.1.0). The download is checked
#                  against the release's SHA256SUMS. Run on its own, without the other files from
#                  macos/ next to it (curl -fsSL <release>/install.sh | sh -s -- --latest), it
#                  fetches those from the release too.
#   (no option)    an already installed binary is left as it is.
#
# Downloads use curl (which sets no quarantine flag) and fall back to `gh release download`, which
# is what works while the repository is private. R2FL_REPO (default crcatala/r2-fastlink) names a
# fork's repository.
#
# Nothing here contains a token or endpoint: that stays in the r2fl config file.
# Remove everything again with macos/uninstall.sh.

set -eu

binary_src=""
download=""
release_tag=""
usage() {
  echo "usage: install.sh [--binary FILE | --latest | --version TAG]" >&2
  exit 2
}
case ${1-} in
  --binary)
    binary_src=${2-}
    if [ -z "$binary_src" ] || [ ! -f "$binary_src" ]; then
      echo "install.sh: --binary needs an existing file." >&2
      exit 2
    fi
    [ "$#" -eq 2 ] || usage
    ;;
  --latest)
    download=1
    [ "$#" -eq 1 ] || usage
    ;;
  --version)
    download=1
    release_tag=${2-}
    [ -n "$release_tag" ] && [ "$#" -eq 2 ] || usage
    case $release_tag in
      v*) ;;
      *) release_tag="v$release_tag" ;;
    esac
    # The tag ends up in a URL and a file name: only what a version tag can contain.
    case $release_tag in
      *[!A-Za-z0-9._-]*)
        echo "install.sh: '$release_tag' is not a release tag (expected something like v0.1.0)." >&2
        exit 2
        ;;
    esac
    ;;
  "") ;;
  *) usage ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
services="$HOME/Library/Services"
bin_dir="$HOME/.local/bin"
config_dir=${R2FL_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/r2fl}
path_file="$config_dir/quick-action-path"
data_dir=${R2FL_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/r2fl}
bin_file="$data_dir/bin/r2fl"
notify_dir="$data_dir/notify"
applet="$notify_dir/r2-fastlink.app"
# What a Quick Action starts with. Your Terminal already has a full PATH, so testing there would
# find r2fl even when the Quick Action cannot. Overridable only so tests can use a fake r2fl.
minimal_path=${R2FL_QUICK_MINIMAL_PATH:-/usr/bin:/bin:/usr/sbin:/sbin}
pbs=/System/Library/CoreServices/pbs

if [ "$(uname -s)" != "Darwin" ] && [ "${R2FL_INSTALL_ANY_OS:-}" != "1" ]; then
  echo "install.sh: the Finder Quick Actions are macOS only." >&2
  exit 1
fi

# Finder starts Quick Actions without your shell's variables, so they always look in the default
# place. A binary or notifier installed elsewhere would be installed but never found.
if [ -n "${R2FL_DATA_DIR:-}" ] || [ -n "${XDG_DATA_HOME:-}" ]; then
  echo "note: R2FL_DATA_DIR / XDG_DATA_HOME is set here, but Quick Actions do not see shell variables:" >&2
  echo "      they look in \$HOME/.local/share/r2fl. Unset the variable and run this again to use that." >&2
fi

# --- Fetching a release (--latest / --version) -------------------------------------------------
repo=${R2FL_REPO:-crcatala/r2-fastlink}
# R2FL_RELEASE_BASE (a folder or URL holding the release assets) replaces GitHub: for mirrors, tests.
release_base=${R2FL_RELEASE_BASE:-}
work=""
cleanup() { [ -z "$work" ] || rm -rf "$work"; }
trap cleanup EXIT

# fetch ASSET DEST: curl first, then `gh release download` (needed while the repository is private).
fetch() {
  if [ -n "$release_base" ]; then
    url="$release_base/$1"
  elif [ -n "$release_tag" ]; then
    url="https://github.com/$repo/releases/download/$release_tag/$1"
  else
    url="https://github.com/$repo/releases/latest/download/$1"
  fi
  if curl -fsSL "$url" -o "$2" 2>/dev/null; then
    return 0
  fi
  if [ -z "$release_base" ] && command -v gh >/dev/null 2>&1; then
    if [ -n "$release_tag" ]; then
      gh release download "$release_tag" --repo "$repo" --pattern "$1" --output "$2" --clobber >/dev/null 2>&1 && return 0
    else
      gh release download --repo "$repo" --pattern "$1" --output "$2" --clobber >/dev/null 2>&1 && return 0
    fi
  fi
  echo "install.sh: could not download $1 (${release_tag:-latest release of $repo})." >&2
  echo "  Check your connection and the version. For a private repository, install the GitHub CLI and run \`gh auth login\`." >&2
  exit 1
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

# verify FILE NAME: FILE must match the SHA256SUMS entry for NAME.
verify() {
  want=$(awk -v n="$2" '$2 == n { print $1 }' "$work/SHA256SUMS")
  if [ -z "$want" ]; then
    echo "install.sh: SHA256SUMS has no entry for $2; refusing to install it." >&2
    exit 1
  fi
  if [ "$(sha256_of "$1")" != "$want" ]; then
    echo "install.sh: the checksum of $2 does not match SHA256SUMS; refusing to install it." >&2
    exit 1
  fi
}

if [ -n "$download" ]; then
  case $(uname -m) in
    arm64 | aarch64) target=darwin-arm64 ;;
    x86_64) target=darwin-x64 ;;
    *)
      echo "install.sh: unsupported architecture $(uname -m)" >&2
      exit 1
      ;;
  esac
  work=$(mktemp -d "${TMPDIR:-/tmp}/r2fl-install.XXXXXX")
  echo "Downloading ${release_tag:-the latest release} ($target)..." >&2
  fetch SHA256SUMS "$work/SHA256SUMS"
  fetch "r2fl-$target" "$work/r2fl-$target"
  verify "$work/r2fl-$target" "r2fl-$target"
  binary_src="$work/r2fl-$target"
  # Run on its own (curl | sh) the Quick Action files are not next to this script: fetch them.
  if [ ! -f "$here/r2fl-quick.sh" ] || [ ! -d "$here/Share via r2-fastlink.workflow" ]; then
    fetch r2fl-macos-support.tar.gz "$work/support.tar.gz"
    verify "$work/support.tar.gz" r2fl-macos-support.tar.gz
    mkdir "$work/support"
    tar -xzf "$work/support.tar.gz" -C "$work/support"
    here="$work/support/macos"
  fi
fi
if [ ! -f "$here/r2fl-quick.sh" ] || [ ! -d "$here/Share via r2-fastlink.workflow" ]; then
  echo "install.sh: the Quick Action files are not next to this script. Run it from the macos/ folder, or use --latest." >&2
  exit 1
fi

mkdir -p "$services" "$bin_dir"

for name in "Share via r2-fastlink" "Share via r2-fastlink (default lifetime)"; do
  rm -rf "${services:?}/$name.workflow"
  cp -R "$here/$name.workflow" "$services/$name.workflow"
  # Files that came from a downloaded zip may be quarantined, and Gatekeeper then blocks them.
  xattr -dr com.apple.quarantine "$services/$name.workflow" 2>/dev/null || true
  echo "installed: $services/$name.workflow"
done

install -m 755 "$here/r2fl-quick.sh" "$bin_dir/r2fl-quick"
echo "installed: $bin_dir/r2fl-quick"

# The notifier applet: notifications from plain osascript belong to Script Editor, which a click
# on them opens. Ones from this applet belong to "r2-fastlink" and a click does nothing.
if command -v osacompile >/dev/null 2>&1; then
  mkdir -p "$notify_dir/pending"
  chmod 700 "$notify_dir/pending" # the queued messages hold links to your uploads
  rm -rf "$applet"
  if osacompile -o "$applet" "$here/notify-applet.applescript" 2>/dev/null; then
    # No Dock icon, a stable identity for the notification settings, then sign it again (ad hoc).
    defaults write "$applet/Contents/Info" LSUIElement -bool true >/dev/null 2>&1 || true
    defaults write "$applet/Contents/Info" CFBundleIdentifier -string dev.r2fastlink.notify >/dev/null 2>&1 || true
    defaults write "$applet/Contents/Info" CFBundleName -string r2-fastlink >/dev/null 2>&1 || true
    xattr -dr com.apple.quarantine "$applet" 2>/dev/null || true
    if command -v codesign >/dev/null 2>&1; then
      codesign --force --deep --sign - "$applet" >/dev/null 2>&1 || true
    fi
    echo "installed: $applet"
  else
    echo "note: could not build the notifier; notifications will open Script Editor when clicked." >&2
  fi
else
  echo "note: osacompile not found; notifications will open Script Editor when clicked." >&2
fi

# Refresh the Services menu so the new items show up without logging out.
if [ -x "$pbs" ]; then
  "$pbs" -flush >/dev/null 2>&1 || true
else
  echo "note: pbs not found; log out and back in if the Quick Actions do not appear."
fi

if [ -n "$binary_src" ]; then
  mkdir -p "$data_dir/bin"
  rm -f "$bin_file"
  install -m 755 "$binary_src" "$bin_file"
  # Browser or AirDrop downloads are quarantined; Apple Silicon also refuses to run an unsigned
  # (cross-compiled) executable, so sign it ad hoc. Neither needs a developer account.
  xattr -dr com.apple.quarantine "$bin_file" 2>/dev/null || true
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$bin_file" >/dev/null 2>&1 || echo "note: codesign failed; the binary may not start." >&2
  fi
  # Run it the way a Quick Action will: bare environment, no PATH.
  if env -i HOME="$HOME" PATH="$minimal_path" "$bin_file" --version >/dev/null 2>&1; then
    echo "installed: $bin_file ($(env -i HOME="$HOME" PATH="$minimal_path" "$bin_file" --version))"
  else
    rm -f "$bin_file"
    echo "WARNING: the binary does not start on this Mac (wrong architecture or blocked). It was removed; the Quick Actions will use your own r2fl instead." >&2
  fi
fi

# A Quick Action starts with a bare PATH, but this terminal can find r2fl and node. Record the
# directories they live in so the wrapper can use them (edit the file by hand if you like).
r2fl_bin=$(command -v r2fl 2>/dev/null || true)
node_bin=$(command -v node 2>/dev/null || true)
if [ -n "$r2fl_bin" ] && [ -n "$node_bin" ]; then
  recorded=$(dirname "$r2fl_bin")
  [ "$(dirname "$node_bin")" = "$recorded" ] || recorded="$recorded:$(dirname "$node_bin")"
  mkdir -p "$config_dir"
  printf '%s\n' "$recorded" >"$path_file"
  echo "recorded:  $path_file ($recorded)"
fi

# Check it the way a Quick Action will run it: a bare environment, through the installed wrapper.
echo
if env -i HOME="$HOME" USER="${USER:-}" PATH="$minimal_path" \
  R2FL_CONFIG_DIR="$config_dir" R2FL_QUICK_SHELL="${R2FL_QUICK_SHELL:-/bin/zsh}" \
  "$bin_dir/r2fl-quick" --check >/dev/null 2>&1; then
  echo "r2fl and node are found the way a Quick Action will look for them."
  r2fl_cmd=$r2fl_bin
  [ ! -x "$bin_file" ] || r2fl_cmd=$bin_file
  if [ "$("$r2fl_cmd" config get endpoint 2>/dev/null | tail -n 1)" = "(not set)" ]; then
    echo "r2fl is not configured yet: run \`$r2fl_cmd init --endpoint https://<your worker>\` first." >&2
  fi
else
  cat >&2 <<'MSG'
WARNING: a Quick Action cannot find both `r2fl` and `node`, so it would fail.
  - Run this installer from a Terminal where `r2fl --version` works (it records where r2fl and
    node live). Install the CLI first if needed (see "Install the CLI" in the README).
  - Or install a standalone binary, which needs neither: install.sh --binary FILE
  - Or put the directories yourself, colon separated, in the first line of
    ~/.config/r2fl/quick-action-path (for example: /Users/me/.local/bin:/opt/homebrew/bin).
MSG
fi

cat <<'MSG'

Enable it (first time only):
  System Settings -> Keyboard -> Keyboard Shortcuts... -> Services -> Files and Folders
  and tick "Share via r2-fastlink" (and the "(default lifetime)" one if you want it).
Use it: right-click a file in Finder -> Quick Actions (or Services) -> Share via r2-fastlink.
The first notification may need allowing: System Settings -> Notifications -> Script Editor.
MSG
