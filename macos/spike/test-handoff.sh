#!/bin/sh
# Checks the host app half of the spike without Finder: creates files with awkward names, opens the
# same r2fl-spike:// URL the extension would build, and compares the host app's log line by line.
# Needs the app installed by run.sh. Run on a Mac:   sh macos/spike/test-handoff.sh
#
# `--encode-only` prints the URL and exits (works on any OS; the Linux unit test uses it).

set -eu

dir="${R2FL_SPIKE_FILES:-$HOME/r2fl-spike-files}"
log="${R2FL_SPIKE_LOG:-$HOME/Library/Logs/r2fl-spike.log}"

# Percent-encode every byte except A-Z a-z 0-9 - . _ ~  (what Shared/HandOff.swift does).
enc() { printf '%s' "$1" | LC_ALL=C perl -0777 -pe 's/([^A-Za-z0-9._~-])/sprintf("%%%02X", ord($1))/ge'; }

# Files to hand off, one per line. None of the names may contain a newline.
list() {
  printf '%s\n' \
    "$dir/plain.txt" \
    "$dir/with space.txt" \
    "$dir/quote\"s and 'single'.txt" \
    "$dir/-leading-dash.txt" \
    "$dir/ünïcödé 日本語 🚀.txt" \
    "$dir/a&b=c+d%20e#f?g.txt"
}

ttl=1h
url="r2fl-spike://share?ttl=$(enc "$ttl")"
count=0
while IFS= read -r p; do
  url="$url&path=$(enc "$p")"
  count=$((count + 1))
done <<LIST
$(list)
LIST

if [ "${1:-}" = "--encode-only" ]; then printf '%s\n' "$url"; exit 0; fi

[ "$(uname -s)" = Darwin ] || { echo "Run on macOS (use --encode-only elsewhere)."; exit 1; }
mkdir -p "$dir"
list | while IFS= read -r p; do : > "$p"; done

before=0
[ ! -f "$log" ] || before=$(wc -l < "$log")
open "$url"

n=0
while [ "$n" -lt 20 ]; do
  now=0
  [ ! -f "$log" ] || now=$(wc -l < "$log")
  [ "$now" -ge $((before + count + 1)) ] && break
  sleep 0.5; n=$((n + 1))
done
[ "$now" -ge $((before + count + 1)) ] || { echo "FAIL: host app wrote nothing to $log (is it installed? did macOS block it?)"; exit 1; }

got=$(tail -n $((count + 1)) "$log")
header=$(printf '%s\n' "$got" | head -n 1)
fails=0
case "$header" in
  *" ttl=$ttl count=$count") echo "PASS: header '$header'" ;;
  *) echo "FAIL: header was '$header', wanted ttl=$ttl count=$count"; fails=$((fails + 1)) ;;
esac
i=0
list | while IFS= read -r p; do
  i=$((i + 1))
  if printf '%s\n' "$got" | grep -Fxq -- "  $i: $p"; then echo "PASS: $i: $p"; else echo "FAIL: $i: $p"; echo "FAILED" > "$dir/.failed"; fi
done
if [ -f "$dir/.failed" ]; then rm -f "$dir/.failed"; fails=$((fails + 1)); fi
echo
echo "Also confirm by eye: a notification from 'r2-fastlink' (not Script Editor) saying 'would share $count file(s) for $ttl: ...'."
[ "$fails" -eq 0 ] && echo "ALL PASSED" || { echo "$fails problem(s)"; exit 1; }
