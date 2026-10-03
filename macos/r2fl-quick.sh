#!/bin/sh
# r2fl-quick: wrapper behind the "Share via r2-fastlink" Finder Quick Actions.
#
# Usage: r2fl-quick [--no-prompt] FILE...
#        r2fl-quick --check        (are r2fl and node found? used by install.sh)
#
# Finder Quick Actions run with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so `r2fl` and
# `node` (Homebrew, mise, nvm...) are not found. Two ways around that, in this order:
#   A. the standalone r2fl binary that install.sh --binary put at <data dir>/bin/r2fl (no node,
#      PATH or shell involved); R2FL_QUICK_BIN overrides the location;
#   B. otherwise (no binary, or it exits 126/127) every r2fl call runs in the user's login shell,
#      with the directories recorded by install.sh added to PATH:
#   1. the file <config dir>/quick-action-path (colon-separated directories; written by
#      install.sh from the Terminal it ran in, editable by hand) is put in front of PATH;
#   2. if r2fl is still not found (stale directory, PATH set up only in ~/.zshrc), the same
#      call is retried once in an interactive login shell, which also reads ~/.zshrc.
#
# Unless --no-prompt is given, a "Link lifetime" list is shown first, with the configured
# default (`r2fl config get defaultTtl`) preselected. Cancelling uploads nothing and exits 0.
# Then `r2fl up --notify` uploads the files; it posts the result notification itself.
#
# Test hooks (not meant for users): R2FL_QUICK_SHELL replaces /bin/zsh, R2FL_QUICK_OSASCRIPT
# replaces /usr/bin/osascript.

set -u

LOGIN_SHELL=${R2FL_QUICK_SHELL:-/bin/zsh}
OSASCRIPT=${R2FL_QUICK_OSASCRIPT:-/usr/bin/osascript}
CONFIG_DIR=${R2FL_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/r2fl}
DATA_DIR=${R2FL_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/r2fl}
R2FL_BIN=${R2FL_QUICK_BIN:-$DATA_DIR/bin/r2fl}
PATH_FILE=$CONFIG_DIR/quick-action-path
NOT_FOUND_HINT="r2fl or node was not found. Run macos/install.sh again from a Terminal where r2fl works. See the README (Finder integration)."

# Directories recorded by install.sh (first line only).
recorded_path=""
if [ -r "$PATH_FILE" ]; then
  recorded_path=$(sed -n '1{s/^[[:space:]]*//;s/[[:space:]]*$//;p;}' "$PATH_FILE")
fi

prompt=1
check=0
if [ "${1-}" = "--check" ]; then
  check=1
  shift
fi
if [ "${1-}" = "--no-prompt" ]; then
  prompt=0
  shift
fi

if [ "$#" -eq 0 ] && [ "$check" -eq 0 ]; then
  echo "usage: r2fl-quick [--no-prompt] FILE..." >&2
  exit 2
fi

# Post a notification. Only fixed text from this script is ever passed, never file names, and
# it travels as osascript arguments rather than being spliced into the AppleScript source.
notify_problem() {
  echo "r2fl-quick: $2" >&2
  "$OSASCRIPT" \
    -e 'on run argv' \
    -e 'display notification (item 2 of argv) with title "r2-fastlink" subtitle (item 1 of argv)' \
    -e 'end run' \
    "$1" "$2" >/dev/null 2>&1
  return 0
}

# Runs inside the login shell (hence single quotes): recorded directories first on PATH.
# shellcheck disable=SC2016
PATH_PREFIX='[ -z "$R2FL_QUICK_PATH" ] || PATH="$R2FL_QUICK_PATH:$PATH"; '

# Run a shell command in the login shell, recorded directories first on PATH. $1 is the command
# text; the remaining arguments reach it untouched as "$@".
login_run() {
  script=$1
  shift
  env R2FL_QUICK_PATH="$recorded_path" "$LOGIN_SHELL" -l -c \
    "$PATH_PREFIX$script" r2fl "$@"
  status=$?
  # 126/127: nothing usable was found. Try once more where ~/.zshrc is read too.
  if [ "$status" -eq 126 ] || [ "$status" -eq 127 ]; then
    env R2FL_QUICK_PATH="$recorded_path" "$LOGIN_SHELL" -l -i -c \
      "$PATH_PREFIX$script" r2fl "$@"
    status=$?
  fi
  return "$status"
}

have_binary() {
  [ -f "$R2FL_BIN" ] && [ -x "$R2FL_BIN" ]
}

# Run `r2fl ARGS...`: the standalone binary if installed, else (or if it cannot start at all) the
# user's own r2fl through the login shell.
login_r2fl() {
  if have_binary; then
    "$R2FL_BIN" "$@"
    status=$?
    if [ "$status" -ne 126 ] && [ "$status" -ne 127 ]; then
      return "$status"
    fi
  fi
  login_run 'r2fl "$@"' "$@"
}

# `choose from list` item for a TTL, and back.
label_for() {
  case $1 in
    15m) echo "15 minutes" ;;
    1h) echo "1 hour" ;;
    1d) echo "1 day" ;;
    7d) echo "7 days" ;;
    *) echo "$1" ;;
  esac
}

ttl_for() {
  case $1 in
    "15 minutes") echo 15m ;;
    "1 hour") echo 1h ;;
    "1 day") echo 1d ;;
    "7 days") echo 7d ;;
    *) echo "$1" ;; # a custom default (for example 45m) is listed as itself
  esac
}

# Which build is this? Shown in the lifetime dialog to tell a stale install from a fresh one.
build_label() {
  ver=$(login_r2fl --version 2>/dev/null | tail -n 1 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ -n "$ver" ] || ver="unknown version"
  if have_binary; then src="standalone"; else src="from PATH"; fi
  echo "r2fl $ver, $src"
}

# Show the lifetime list and print the chosen TTL (nothing at all if cancelled).
# $1 is the configured default, which is preselected and added to the list when it is not one
# of the standard items; the last argument is the build label. List items travel as osascript arguments, so config text can never
# become AppleScript source; the script itself is fixed.
choose_ttl() {
  default_label=$(label_for "$1")
  set -- "$default_label" "15 minutes" "1 hour" "1 day" "7 days"
  case $1 in
    "15 minutes" | "1 hour" | "1 day" | "7 days") ;;
    *) set -- "$@" "$1" ;;
  esac
  set -- "$@" "$(build_label)"
  picked=$("$OSASCRIPT" \
    -e 'on run argv' \
    -e 'set theItems to items 2 thru -2 of argv' \
    -e 'set picked to choose from list theItems with title "r2-fastlink" with prompt ("Link lifetime" & return & (item -1 of argv)) default items {item 1 of argv}' \
    -e 'if picked is false then return ""' \
    -e 'return item 1 of picked' \
    -e 'end run' \
    "$@") || return 1
  case $picked in
    "" | false) return 0 ;;
  esac
  ttl_for "$picked"
}

if [ "$check" -eq 1 ]; then
  if have_binary && "$R2FL_BIN" --version >/dev/null 2>&1; then
    echo "$R2FL_BIN"
    exit 0
  fi
  login_run 'command -v r2fl && command -v node || exit 127'
  exit $?
fi

if [ "$prompt" -eq 1 ]; then
  errfile=$(mktemp "${TMPDIR:-/tmp}/r2fl-quick.XXXXXX") || exit 1
  trap 'rm -f "$errfile"' EXIT
  out=$(login_r2fl config get defaultTtl 2>"$errfile")
  status=$?
  if [ "$status" -ne 0 ]; then
    if [ "$status" -eq 126 ] || [ "$status" -eq 127 ]; then
      notify_problem "Could not run r2fl" "$NOT_FOUND_HINT"
    else
      # r2fl ran and refused (for example a corrupt config file): show what it said, not a PATH hint.
      reason=$(grep . "$errfile" | tail -n 1 | cut -c1-200)
      notify_problem "r2fl config error" "${reason:-r2fl config get defaultTtl failed (exit $status).}"
    fi
    exit 1
  fi
  # A login shell may print noise (a greeting from a profile) before the value: take the last
  # line, without surrounding whitespace (r2fl accepts " 15m").
  default_ttl=$(printf '%s\n' "$out" | tail -n 1 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  # Never guess a lifetime: a longer one than configured would keep the file public for longer.
  case $default_ttl in
    *[!0-9smhdwSMHDW]* | "" | [!0-9]*)
      notify_problem "Invalid default lifetime" "defaultTtl is \"$default_ttl\". Fix it with: r2fl config set defaultTtl 1h"
      exit 1
      ;;
  esac
  if ! ttl=$(choose_ttl "$default_ttl"); then
    notify_problem "Could not show the lifetime picker" "osascript failed. Use the \"default lifetime\" Quick Action instead."
    exit 1
  fi
  # Cancelled: upload nothing, say nothing, and do not report an error.
  [ -n "$ttl" ] || exit 0
  set -- --ttl "$ttl" -- "$@"
else
  set -- -- "$@"
fi

# `--` keeps file names that start with a dash from being read as options.
login_r2fl up --notify "$@"
status=$?
# 126/127: the shell found no usable r2fl (or no node for its shebang). r2fl itself never exits
# with these, and it cannot post the notification when it never started.
if [ "$status" -eq 126 ] || [ "$status" -eq 127 ]; then
  notify_problem "Could not run r2fl" "$NOT_FOUND_HINT"
fi
exit "$status"
