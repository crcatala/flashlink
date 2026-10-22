#!/bin/sh
# Install flashlink on a Mac: the `fl` command and the Finder Quick Actions ("Share via flashlink").
#
#   ~/.local/share/flashlink/bin/fl           the standalone fl (Bun runtime included: no node needed)
#   ~/.local/bin/fl, ~/.local/bin/flashlink   symlinks to it, so `fl` works in your terminal
#   ~/Library/Services/Share via flashlink.workflow                      (asks for a lifetime)
#   ~/Library/Services/Share via flashlink (default lifetime).workflow   (no question)
#   ~/.local/bin/fl-quick                     the wrapper both Quick Actions call; it runs the standalone fl
#   ~/.local/share/flashlink/notify/flashlink.app   (posts the notifications; see notify-applet.applescript)
#   ~/.config/flashlink/quick-action-path     (only without a standalone fl: where fl and node were
#                                              found in THIS terminal)
#
# Usage: install.sh [--latest | --version TAG | --binary FILE]
#   --latest       download the newest GitHub release's fl for this Mac and install everything
#   --version TAG  the same for one release (TAG is for example v0.1.0 or 0.1.0). Downloads are
#                  checked against the release's SHA256SUMS, and the Quick Action files come from
#                  that same release, so this works on its own:
#                    curl -fsSL <release>/install.sh | sh -s -- --latest
#   --binary FILE  install a standalone fl built by scripts/build-binary.sh (development)
#   (no option)    install the Quick Actions from this folder and keep the installed fl; without
#                  one, they use your own fl and node, found the way your terminal finds them
#                  (development; see docs/MACOS.md)
#
# The `fl` symlinks are only created where nothing else is: an fl you installed some other way is
# left alone. Downloads use curl (which sets no quarantine flag) and fall back to `gh release
# download`, which works while the repository is private. FLASHLINK_REPO (default
# crcatala/flashlink) names a fork's repository.
#
# Nothing here contains a token or endpoint: that stays in the fl config file.
# Remove everything again with macos/uninstall.sh.

# The ~ in messages is shown to the user, never expanded.
# shellcheck disable=SC2088

set -eu

# --- Output --------------------------------------------------------------------------------------
# Colors only on a terminal, and never with NO_COLOR (https://no-color.org) or TERM=dumb.
if [ -t 1 ] && [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  bold=$(printf '\033[1m') dim=$(printf '\033[2m') green=$(printf '\033[32m')
  yellow=$(printf '\033[33m') red=$(printf '\033[31m') blue=$(printf '\033[34m') reset=$(printf '\033[0m')
else
  bold="" dim="" green="" yellow="" red="" blue="" reset=""
fi
step() { printf '\n%s==>%s %s%s%s\n' "$blue" "$reset" "$bold" "$1" "$reset"; }
ok() { printf '  %s✓%s %-14s %s\n' "$green" "$reset" "$1" "${2-}"; }
# Problems go to stderr: a headline, then indented detail lines.
warn() {
  printf '  %s!%s %s\n' "$yellow" "$reset" "$1" >&2
  shift
  for line in "$@"; do printf '    %s\n' "$line" >&2; done
}
die() {
  printf '%s✗ install.sh:%s %s\n' "$red" "$reset" "$1" >&2
  shift
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  exit 1
}
# A path as you would type it: ~/... instead of /Users/you/...
short() {
  case $1 in
    "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

binary_src=""
download=""
release_tag=""
usage() {
  echo "usage: install.sh [--latest | --version TAG | --binary FILE]" >&2
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
config_dir=${FLASHLINK_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/flashlink}
path_file="$config_dir/quick-action-path"
data_dir=${FLASHLINK_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/flashlink}
bin_file="$data_dir/bin/fl"
notify_dir="$data_dir/notify"
applet="$notify_dir/flashlink.app"
# What a Quick Action starts with. Your Terminal already has a full PATH, so testing there would
# find fl even when the Quick Action cannot. Overridable only so tests can use a fake fl.
minimal_path=${FLASHLINK_QUICK_MINIMAL_PATH:-/usr/bin:/bin:/usr/sbin:/sbin}
pbs=/System/Library/CoreServices/pbs

if [ "$(uname -s)" != "Darwin" ] && [ "${FLASHLINK_INSTALL_ANY_OS:-}" != "1" ]; then
  die "this installer is macOS only." "On Linux, install the CLI with npm: npm i -g flashlink"
fi

printf '%sflashlink installer%s\n' "$bold" "$reset"

# Finder starts Quick Actions without your shell's variables, so they always look in the default
# place. A binary or notifier installed elsewhere would be installed but never found.
if [ -n "${FLASHLINK_DATA_DIR:-}" ] || [ -n "${XDG_DATA_HOME:-}" ]; then
  warn "FLASHLINK_DATA_DIR / XDG_DATA_HOME is set here, but Quick Actions do not see shell variables:" \
    "they look in \$HOME/.local/share/flashlink. Unset the variable and run this again to use that."
fi

# --- Fetching a release (--latest / --version) -------------------------------------------------
repo=${FLASHLINK_REPO:-crcatala/flashlink}
# FLASHLINK_RELEASE_BASE (a folder or URL holding the release assets) replaces GitHub: for mirrors, tests.
release_base=${FLASHLINK_RELEASE_BASE:-}
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
  die "could not download $1 (${release_tag:-latest release of $repo})." \
    "Check your connection and the version. For a private repository, install the GitHub CLI and run \`gh auth login\`."
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
  [ -n "$want" ] || die "SHA256SUMS has no entry for $2; refusing to install it."
  [ "$(sha256_of "$1")" = "$want" ] || die "the checksum of $2 does not match SHA256SUMS; refusing to install it."
}

if [ -n "$download" ]; then
  case $(uname -m) in
    arm64 | aarch64) target=darwin-arm64 ;;
    x86_64) target=darwin-x64 ;;
    *) die "unsupported architecture $(uname -m)" ;;
  esac
  work=$(mktemp -d "${TMPDIR:-/tmp}/flashlink-install.XXXXXX")
  step "Downloading ${release_tag:-the latest release} ($target)"
  fetch SHA256SUMS "$work/SHA256SUMS"
  fetch "flashlink-$target" "$work/flashlink-$target"
  verify "$work/flashlink-$target" "flashlink-$target"
  binary_src="$work/flashlink-$target"
  # Always take the Quick Action files from the same release as the binary, even from inside a
  # checkout: a pinned version must not mix in whatever commit the checkout happens to be at. (It
  # also covers `curl | sh`, where no other file is next to this script.)
  fetch flashlink-macos-support.tar.gz "$work/support.tar.gz"
  verify "$work/support.tar.gz" flashlink-macos-support.tar.gz
  mkdir "$work/support"
  tar -xzf "$work/support.tar.gz" -C "$work/support"
  here="$work/support/macos"
  ok "verified" "against the release's SHA256SUMS"
fi
if [ ! -f "$here/fl-quick.sh" ] || [ ! -d "$here/Share via flashlink.workflow" ]; then
  die "the Quick Action files are not next to this script." "Run it from the macos/ folder, or use --latest."
fi

mkdir -p "$bin_dir"

# --- The fl command ------------------------------------------------------------------------------
step "The fl command"
binary_failed=""
if [ -n "$binary_src" ]; then
  mkdir -p "$data_dir/bin"
  # Prepare and test the new file beside the installed one; only a binary that starts replaces it,
  # so a failed update never costs you the working binary.
  new_file="$bin_file.new"
  rm -f "$new_file"
  install -m 755 "$binary_src" "$new_file"
  # Browser or AirDrop downloads are quarantined; Apple Silicon also refuses to run an unsigned
  # (cross-compiled) executable, so sign it ad hoc. Neither needs a developer account.
  xattr -dr com.apple.quarantine "$new_file" 2>/dev/null || true
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$new_file" >/dev/null 2>&1 || warn "codesign failed; the binary may not start."
  fi
  # Run it the way a Quick Action will: bare environment, no PATH.
  if env -i HOME="$HOME" PATH="$minimal_path" "$new_file" --version >/dev/null 2>&1; then
    mv -f "$new_file" "$bin_file"
  else
    rm -f "$new_file"
    binary_failed=1
    if [ -x "$bin_file" ]; then
      warn "the new fl does not start on this Mac (wrong architecture or blocked)." \
        "Your previous binary was kept: $(short "$bin_file")"
    else
      warn "fl does not start on this Mac (wrong architecture or blocked), so it was not installed."
    fi
  fi
fi
# Before 0.0.3 the installer put a `flashlink` alias next to the binary; ~/.local/bin has it now.
[ ! -L "$data_dir/bin/flashlink" ] || rm -f "$data_dir/bin/flashlink"

have_binary=""
if [ -x "$bin_file" ] && env -i HOME="$HOME" PATH="$minimal_path" "$bin_file" --version >/dev/null 2>&1; then
  have_binary=1
  ok "installed" "fl $(env -i HOME="$HOME" PATH="$minimal_path" "$bin_file" --version 2>/dev/null | tail -n 1), $(short "$bin_file")"

  # Link it into ~/.local/bin, but never over something this installer did not put there.
  linked="" foreign=""
  for name in fl flashlink; do
    link="$bin_dir/$name"
    if [ -L "$link" ]; then
      case $(readlink "$link") in
        "$data_dir"/bin/*) ln -sf "$bin_file" "$link" ;; # ours (maybe from an older layout)
        *)
          foreign="$foreign $(short "$link")"
          continue
          ;;
      esac
    elif [ -e "$link" ]; then
      foreign="$foreign $(short "$link")"
      continue
    else
      ln -s "$bin_file" "$link"
    fi
    linked="${linked:+$linked, }$(short "$link")"
  done
  [ -z "$linked" ] || ok "linked" "$linked"
  [ -z "$foreign" ] || warn "left alone (not from this installer):$foreign"

  # Which fl does this terminal run? (Quick Actions do not care: they run the binary directly.)
  terminal_fl=$(command -v fl 2>/dev/null || true)
  if [ -n "$terminal_fl" ] && [ "$terminal_fl" -ef "$bin_file" ]; then
    ok "on your PATH" "typing \`fl\` runs it"
  elif [ -z "$terminal_fl" ]; then
    case ${SHELL:-/bin/zsh} in
      */bash) rc="~/.bash_profile" ;;
      *) rc="~/.zshrc" ;;
    esac
    warn "~/.local/bin is not on your PATH, so typing \`fl\` does not find it yet. Add it once:" \
      "echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $rc" \
      "then open a new terminal window. (The Finder menu works either way.)"
  else
    other=$("$terminal_fl" --version 2>/dev/null | tail -n 1 || true)
    warn "this terminal runs a different fl first: $(short "$terminal_fl")${other:+ ($other)}" \
      "The Finder menu uses the one installed here. To have only this one, remove the other" \
      "(for example \`npm uninstall -g flashlink\`) or put ~/.local/bin earlier on your PATH."
  fi
else
  fl_bin=$(command -v fl 2>/dev/null || true)
  if [ -n "$fl_bin" ]; then
    ok "your own fl" "$(short "$fl_bin") (no standalone fl installed; the Quick Actions use this one)"
  elif [ -z "$binary_failed" ]; then
    warn "no fl found: there is no standalone fl and your terminal has none either." \
      "Install it with: curl -fsSL https://github.com/$repo/releases/latest/download/install.sh | sh -s -- --latest"
  fi
fi

# --- Finder integration --------------------------------------------------------------------------
step "Finder integration"
mkdir -p "$services"
for name in "Share via flashlink" "Share via flashlink (default lifetime)"; do
  rm -rf "${services:?}/$name.workflow"
  cp -R "$here/$name.workflow" "$services/$name.workflow"
  # Files that came from a downloaded zip may be quarantined, and Gatekeeper then blocks them.
  xattr -dr com.apple.quarantine "$services/$name.workflow" 2>/dev/null || true
  ok "Quick Action" "$name"
done

install -m 755 "$here/fl-quick.sh" "$bin_dir/fl-quick"
ok "wrapper" "$(short "$bin_dir/fl-quick")"

# The notifier applet: notifications from plain osascript belong to Script Editor, which a click
# on them opens. Ones from this applet belong to "flashlink" and a click does nothing.
notifier=""
if command -v osacompile >/dev/null 2>&1; then
  mkdir -p "$notify_dir/pending"
  chmod 700 "$notify_dir/pending" # the queued messages hold links to your uploads
  rm -rf "$applet"
  if osacompile -o "$applet" "$here/notify-applet.applescript" 2>/dev/null; then
    # No Dock icon, a stable identity for the notification settings, then sign it again (ad hoc).
    defaults write "$applet/Contents/Info" LSUIElement -bool true >/dev/null 2>&1 || true
    defaults write "$applet/Contents/Info" CFBundleIdentifier -string dev.r2fastlink.notify >/dev/null 2>&1 || true
    defaults write "$applet/Contents/Info" CFBundleName -string flashlink >/dev/null 2>&1 || true
    xattr -dr com.apple.quarantine "$applet" 2>/dev/null || true
    if command -v codesign >/dev/null 2>&1; then
      codesign --force --deep --sign - "$applet" >/dev/null 2>&1 || true
    fi
    notifier=1
    ok "notifier" "$(short "$applet")"
  else
    warn "could not build the notifier; notifications will open Script Editor when clicked."
  fi
else
  warn "osacompile not found; notifications will open Script Editor when clicked."
fi

# Refresh the Services menu so the new items show up without logging out.
if [ -x "$pbs" ]; then
  "$pbs" -flush >/dev/null 2>&1 || true
else
  warn "pbs not found; log out and back in if the Quick Actions do not appear."
fi

# Without a standalone fl, a Quick Action (bare PATH) runs your own fl through your login shell.
# Record where this terminal finds fl and node so the wrapper can add them (editable by hand).
if [ -z "$have_binary" ]; then
  fl_bin=$(command -v fl 2>/dev/null || true)
  node_bin=$(command -v node 2>/dev/null || true)
  if [ -n "$fl_bin" ] && [ -n "$node_bin" ]; then
    recorded=$(dirname "$fl_bin")
    [ "$(dirname "$node_bin")" = "$recorded" ] || recorded="$recorded:$(dirname "$node_bin")"
    mkdir -p "$config_dir"
    printf '%s\n' "$recorded" >"$path_file"
    ok "recorded" "where fl and node are, in $(short "$path_file")"
  fi
fi

# Check it the way a Quick Action will run it: a bare environment, through the installed wrapper.
if env -i HOME="$HOME" USER="${USER:-}" PATH="$minimal_path" \
  FLASHLINK_CONFIG_DIR="$config_dir" FLASHLINK_QUICK_SHELL="${FLASHLINK_QUICK_SHELL:-/bin/zsh}" \
  "$bin_dir/fl-quick" --check >/dev/null 2>&1; then
  ok "checked" "a Quick Action can run fl"
else
  warn "a Quick Action cannot run fl, so the Finder menu would fail." \
    "Install the standalone fl, which needs nothing else:" \
    "  curl -fsSL https://github.com/$repo/releases/latest/download/install.sh | sh -s -- --latest" \
    "(Developing from a clone with your own fl? See \"From a clone\" in docs/MACOS.md.)"
fi

# --- What next -----------------------------------------------------------------------------------
fl_cmd=""
if [ -n "$have_binary" ]; then
  fl_cmd=$bin_file
else
  fl_cmd=$(command -v fl 2>/dev/null || true)
fi
# How to type fl in the instructions: plain `fl` when the terminal finds this one.
fl_typed=fl
if [ -n "$have_binary" ] && ! { [ -n "${terminal_fl:-}" ] && [ "$terminal_fl" -ef "$bin_file" ]; }; then
  fl_typed=$(short "$bin_file")
fi
endpoint=""
[ -z "$fl_cmd" ] || endpoint=$("$fl_cmd" config get endpoint 2>/dev/null | tail -n 1 || true)

printf '\n%sNext steps%s\n' "$bold" "$reset"
n=1
if [ -n "$fl_cmd" ] && { [ -z "$endpoint" ] || [ "$endpoint" = "(not set)" ]; }; then
  printf '  %s%s.%s Connect fl to your Worker (asks for your upload token):\n' "$bold" "$n" "$reset"
  printf '       %s%s init --endpoint https://<your worker>%s\n' "$green" "$fl_typed" "$reset"
  n=$((n + 1))
fi
printf '  %s%s.%s Turn on the Finder menu (first time only):\n' "$bold" "$n" "$reset"
printf '       System Settings → Keyboard → Keyboard Shortcuts… → Services → Files and Folders,\n'
printf '       then tick "Share via flashlink" (and "(default lifetime)" if you want it).\n'
n=$((n + 1))
printf '  %s%s.%s Share a file:\n' "$bold" "$n" "$reset"
printf '       Terminal: %s%s up FILE%s\n' "$green" "$fl_typed" "$reset"
printf '       Finder:   right-click a file → Quick Actions → Share via flashlink\n'
if [ -n "$notifier" ]; then
  printf '  %sThe first notification may ask for permission (System Settings → Notifications → flashlink).%s\n' "$dim" "$reset"
else
  printf '  %sThe first notification may ask for permission (System Settings → Notifications → Script Editor).%s\n' "$dim" "$reset"
fi
printf '  %sUpdate: run the same install command again. Help: https://github.com/%s/blob/main/docs/MACOS.md%s\n' "$dim" "$repo" "$reset"

[ -z "$binary_failed" ] || exit 1
