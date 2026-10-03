#!/bin/sh
# Install the Finder Quick Actions ("Share via r2-fastlink") for the current user.
#
#   ~/Library/Services/Share via r2-fastlink.workflow                      (asks for a lifetime)
#   ~/Library/Services/Share via r2-fastlink (default lifetime).workflow   (no question)
#   ~/.local/bin/r2fl-quick                                                (wrapper both call)
#   ~/.config/r2fl/quick-action-path       (where r2fl and node were found in THIS terminal)
#
# Nothing here contains a token or endpoint: that stays in the r2fl config file.
# Remove everything again with macos/uninstall.sh.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
services="$HOME/Library/Services"
bin_dir="$HOME/.local/bin"
config_dir=${R2FL_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/r2fl}
path_file="$config_dir/quick-action-path"
# What a Quick Action starts with. Your Terminal already has a full PATH, so testing there would
# find r2fl even when the Quick Action cannot. Overridable only so tests can use a fake r2fl.
minimal_path=${R2FL_QUICK_MINIMAL_PATH:-/usr/bin:/bin:/usr/sbin:/sbin}
pbs=/System/Library/CoreServices/pbs

if [ "$(uname -s)" != "Darwin" ] && [ "${R2FL_INSTALL_ANY_OS:-}" != "1" ]; then
  echo "install.sh: the Finder Quick Actions are macOS only." >&2
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

# Refresh the Services menu so the new items show up without logging out.
if [ -x "$pbs" ]; then
  "$pbs" -flush >/dev/null 2>&1 || true
else
  echo "note: pbs not found; log out and back in if the Quick Actions do not appear."
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
  if [ "$("$r2fl_bin" config get endpoint 2>/dev/null | tail -n 1)" = "(not set)" ]; then
    echo "r2fl is not configured yet: run \`r2fl init\` first." >&2
  fi
else
  cat >&2 <<'MSG'
WARNING: a Quick Action cannot find both `r2fl` and `node`, so it would fail.
  - Run this installer from a Terminal where `r2fl --version` works (it records where r2fl and
    node live). Install the CLI first if needed (see "Install the CLI" in the README).
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
