#!/bin/sh
# Install the Finder Quick Actions ("Share via r2-fastlink") for the current user.
#
#   ~/Library/Services/Share via r2-fastlink.workflow                      (asks for a lifetime)
#   ~/Library/Services/Share via r2-fastlink (default lifetime).workflow   (no question)
#   ~/.local/bin/r2fl-quick                                                (wrapper both call)
#
# Nothing here contains a token or endpoint: that stays in the r2fl config file.
# Remove everything again with macos/uninstall.sh.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
services="$HOME/Library/Services"
bin_dir="$HOME/.local/bin"
login_shell=${R2FL_QUICK_SHELL:-/bin/zsh}
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

# The Quick Actions find r2fl through a login shell started from a minimal environment. Check
# that works the way they will use it, not the way your terminal does.
in_quick_action_env() {
  env -i HOME="$HOME" USER="${USER:-}" PATH="$minimal_path" "$login_shell" -l -c "$1"
}

echo
if ! in_quick_action_env 'command -v r2fl >/dev/null 2>&1 && command -v node >/dev/null 2>&1'; then
  cat >&2 <<'MSG'
WARNING: a login shell cannot find both `r2fl` and `node`, so the Quick Actions would fail.
  - Install the CLI (see "Install the CLI" in the README) and make sure `node` is on PATH.
  - Set PATH in ~/.zprofile or ~/.zshenv. Quick Actions do not read ~/.zshrc, and ~/.local/bin
    is not on PATH by default on macOS.
  - See what a Quick Action sees:
      env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -l -c 'command -v r2fl node'
  Then re-run macos/install.sh (or just try the Quick Action).
MSG
elif [ "$(in_quick_action_env 'r2fl config get endpoint' 2>/dev/null | tail -n 1)" = "(not set)" ]; then
  echo "r2fl is installed but not configured yet: run \`r2fl init\` first." >&2
else
  echo "r2fl and node are found by a login shell."
fi

cat <<'MSG'

Enable it (first time only):
  System Settings -> Keyboard -> Keyboard Shortcuts... -> Services -> Files and Folders
  and tick "Share via r2-fastlink" (and the "(default lifetime)" one if you want it).
Use it: right-click a file in Finder -> Quick Actions (or Services) -> Share via r2-fastlink.
The first notification may need allowing: System Settings -> Notifications -> Script Editor.
MSG
