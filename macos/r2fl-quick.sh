#!/bin/sh
# r2fl-quick: wrapper behind the "Share via r2-fastlink" Finder Quick Actions.
#
# Usage: r2fl-quick [--no-prompt] FILE...
#
# Finder Quick Actions run with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so `r2fl` and
# `node` (Homebrew, mise, nvm...) are not found. Every r2fl call therefore goes through the
# user's login shell, which sets up PATH the way a terminal would.
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

prompt=1
if [ "${1-}" = "--no-prompt" ]; then
  prompt=0
  shift
fi

if [ "$#" -eq 0 ]; then
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

# Run `r2fl ARGS...` in a login shell. Arguments reach r2fl untouched ("$@" inside the -c script).
login_r2fl() {
  "$LOGIN_SHELL" -l -c 'r2fl "$@"' r2fl "$@"
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

# Show the lifetime list and print the chosen TTL (nothing at all if cancelled).
# $1 is the configured default, which is preselected and added to the list when it is not one
# of the standard items. List items travel as osascript arguments, so config text can never
# become AppleScript source; the script itself is fixed.
choose_ttl() {
  default_label=$(label_for "$1")
  set -- "$default_label" "15 minutes" "1 hour" "1 day" "7 days"
  case $1 in
    "15 minutes" | "1 hour" | "1 day" | "7 days") ;;
    *) set -- "$@" "$1" ;;
  esac
  picked=$("$OSASCRIPT" \
    -e 'on run argv' \
    -e 'set theItems to items 2 thru -1 of argv' \
    -e 'set picked to choose from list theItems with title "r2-fastlink" with prompt "Link lifetime" default items {item 1 of argv}' \
    -e 'if picked is false then return ""' \
    -e 'return item 1 of picked' \
    -e 'end run' \
    "$@") || return 1
  case $picked in
    "" | false) return 0 ;;
  esac
  ttl_for "$picked"
}

if [ "$prompt" -eq 1 ]; then
  if ! out=$(login_r2fl config get defaultTtl 2>/dev/null); then
    notify_problem "Could not run r2fl" "r2fl or node was not found by your login shell. See the README (Finder integration)."
    exit 1
  fi
  # A login shell may print noise (a greeting from a profile) before the value: take the last line.
  default_ttl=$(printf '%s\n' "$out" | tail -n 1)
  case $default_ttl in
    [0-9]*) ;;
    *) default_ttl=1h ;;
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
  notify_problem "Could not run r2fl" "r2fl or node was not found by your login shell. See the README (Finder integration)."
fi
exit "$status"
