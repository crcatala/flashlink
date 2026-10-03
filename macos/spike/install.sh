#!/bin/sh
# Install an already built spike app (from build.sh, or downloaded from CI), enable its Finder Sync
# extension and restart Finder. No Xcode needed.
#
#   sh macos/spike/install.sh /path/to/r2-fastlink.app     # or a zip made by CI (r2-fastlink-spike.zip)
#   sh macos/spike/install.sh --uninstall

set -eu

APP_NAME="r2-fastlink.app"
DEST="$HOME/Applications"
APP_ID="dev.r2fastlink.spike"
EXT_ID="dev.r2fastlink.spike.FinderSync"
APPEX="$DEST/$APP_NAME/Contents/PlugIns/R2FLFinderSync.appex"

[ "$(uname -s)" = Darwin ] || { echo "macOS only."; exit 1; }

remove_installed() {
  [ ! -d "$APPEX" ] || pluginkit -r "$APPEX" 2>/dev/null || true
  pluginkit -e ignore -i "$EXT_ID" 2>/dev/null || true
  killall r2-fastlink 2>/dev/null || true
  rm -rf "$DEST/$APP_NAME"
}

case "${1:-}" in
  --uninstall)
    remove_installed
    killall Finder 2>/dev/null || true
    echo "Removed $DEST/$APP_NAME and restarted Finder."
    exit 0 ;;
  "") echo "usage: sh install.sh <r2-fastlink.app | r2-fastlink-spike.zip> | --uninstall"; exit 1 ;;
esac

src="$1"
tmp=""
trap '[ -z "$tmp" ] || rm -rf "$tmp"' EXIT
case "$src" in
  *.zip)
    tmp=$(mktemp -d)
    ditto -x -k "$src" "$tmp"
    src="$tmp/$APP_NAME" ;;
esac
[ -d "$src/Contents/PlugIns/R2FLFinderSync.appex" ] || { echo "Not the spike app (no embedded extension): $src"; exit 1; }

remove_installed
mkdir -p "$DEST"
ditto "$src" "$DEST/$APP_NAME"
# A browser download is quarantined; an ad hoc signed app would then be refused by Gatekeeper.
xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true

echo "== signature of what was installed"
codesign -dvv "$DEST/$APP_NAME" 2>&1 | grep -E "Identifier|Signature|TeamIdentifier|Authority" || true
codesign -d --entitlements - "$APPEX" 2>&1 | grep -E "app-sandbox|user-selected" || echo "(no entitlements printed for the extension)"

open "$DEST/$APP_NAME"     # registers the r2fl-spike:// scheme and asks for notification permission
sleep 2
pluginkit -a "$APPEX"
pluginkit -e use -i "$EXT_ID"
killall Finder 2>/dev/null || true

echo "== extension registration (a leading '+' means enabled)"
pluginkit -m -v -i "$EXT_ID" || true
cat <<MSG

Next:
  1. Allow notifications for r2-fastlink if macOS asks.
  2. If the menu does not show up, enable the extension by hand: System Settings > General >
     Login Items & Extensions > Extensions ("Added Extensions" / by category: Finder), or on older
     macOS: Privacy & Security > Extensions > Added Extensions. Then run: killall Finder
  3. Right-click a file in Finder: "Share via r2-fastlink" with 15 minutes / 1 hour / 1 day / 7 days.
  4. Watch what happens:  tail -f ~/Library/Logs/r2fl-spike.log
     Extension logs:      log stream --predicate 'subsystem == "$APP_ID"' --level info
  5. Test the second half of the pipeline without Finder: sh macos/spike/test-handoff.sh
MSG
